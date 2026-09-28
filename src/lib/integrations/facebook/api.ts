import "server-only";

import {
  getFacebookGraphApiVersion,
  getFacebookOAuthConfig,
} from "@/lib/integrations/facebook/config";

const FACEBOOK_GRAPH_ORIGIN = "https://graph.facebook.com";
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_PAGES = 100;
const PAGE_INSIGHT_CHUNK_DAYS = 90;
const PAGE_INSIGHT_METRICS = [
  "page_media_view",
  "page_total_media_view_unique",
  "page_post_engagements",
  "page_views_total",
  "page_follows",
] as const;
const POST_INSIGHT_METRICS = [
  "post_media_view",
  "post_total_media_view_unique",
  "post_engaged_users",
] as const;

export type FacebookPageMetricName = typeof PAGE_INSIGHT_METRICS[number];

export type FacebookUserToken = {
  accessToken: string;
  expiresAt: string;
  scopes: string[];
  tokenType: string;
};

export type FacebookPage = {
  accessToken: string;
  fanCount: number;
  followerCount: number;
  id: string;
  link: string | null;
  name: string;
  pictureUrl: string | null;
  tasks: string[];
  username: string | null;
};

export type FacebookPost = {
  comments: number;
  contentType: string;
  id: string;
  message: string | null;
  permalink: string | null;
  publishedAt: string;
  reactions: number;
  shares: number;
  thumbnailUrl: string | null;
};

export type FacebookPageInsightPoint = {
  date: string;
  metric: FacebookPageMetricName;
  value: number;
};

export type FacebookPageInsightsResult = {
  failedMetrics: FacebookPageMetricName[];
  points: FacebookPageInsightPoint[];
};

export type FacebookPostInsights = {
  engagedUsers: number;
  uniqueViewers: number;
  views: number;
};

export async function exchangeFacebookCode(code: string): Promise<FacebookUserToken> {
  const { appId, appSecret, redirectUri } = getFacebookOAuthConfig();
  const shortUrl = graphUrl("/oauth/access_token");
  shortUrl.searchParams.set("client_id", appId);
  shortUrl.searchParams.set("client_secret", appSecret);
  shortUrl.searchParams.set("code", code);
  shortUrl.searchParams.set("redirect_uri", redirectUri);
  const shortPayload = await facebookRequest(
    shortUrl,
    { method: "GET" },
    "Facebook token exchange",
  );
  const shortToken = readString(shortPayload, "access_token");
  const longUrl = graphUrl("/oauth/access_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", shortToken);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  const longPayload = await facebookRequest(
    longUrl,
    { method: "GET" },
    "Facebook long-lived token exchange",
  );
  const accessToken = readString(longPayload, "access_token");
  const expiresIn = readNonnegativeInteger(longPayload, "expires_in");
  const scopes = await fetchFacebookGrantedScopes(accessToken);

  return {
    accessToken,
    expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    scopes,
    tokenType: optionalString(longPayload, "token_type") ?? "Bearer",
  };
}

export async function fetchFacebookGrantedScopes(accessToken: string) {
  const url = graphUrl("/me/permissions");
  const payload = await facebookGet(url, accessToken, "Facebook permissions");

  return readArray(payload, "data")
    .filter(isRecord)
    .filter((item) => optionalString(item, "status") === "granted")
    .map((item) => readString(item, "permission"));
}

export async function fetchFacebookPages(userAccessToken: string) {
  const pages: FacebookPage[] = [];
  let nextUrl: URL | null = graphUrl("/me/accounts");
  nextUrl.searchParams.set(
    "fields",
    "id,name,username,access_token,picture.type(large),link,followers_count,fan_count,tasks",
  );
  nextUrl.searchParams.set("limit", "100");

  for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
    const payload = await facebookGet(nextUrl, userAccessToken, "Facebook Pages");
    pages.push(...readArray(payload, "data").filter(isRecord).map(parsePage));
    nextUrl = readPagingNextUrl(payload);
  }

  return [...new Map(pages.map((item) => [item.id, item])).values()];
}

export async function fetchFacebookPage(
  pageAccessToken: string,
  pageId: string,
) {
  const url = graphUrl(`/${pageId}`);
  url.searchParams.set(
    "fields",
    "id,name,username,picture.type(large),link,followers_count,fan_count,tasks",
  );
  const payload = await facebookGet(url, pageAccessToken, "Facebook Page profile");
  return parsePage({ ...payload, access_token: pageAccessToken });
}

export async function fetchFacebookPosts(
  pageAccessToken: string,
  pageId: string,
  earliestDate: string,
) {
  const posts: FacebookPost[] = [];
  let nextUrl: URL | null = graphUrl(`/${pageId}/published_posts`);
  nextUrl.searchParams.set(
    "fields",
    "id,message,created_time,permalink_url,full_picture,attachments.limit(1){media_type,type},shares,comments.limit(0).summary(true),reactions.limit(0).summary(true)",
  );
  nextUrl.searchParams.set("limit", "100");
  nextUrl.searchParams.set("since", earliestDate);

  for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
    const payload = await facebookGet(nextUrl, pageAccessToken, "Facebook posts");
    const pagePosts = readArray(payload, "data").filter(isRecord).map(parsePost);
    posts.push(...pagePosts.filter((post) => post.publishedAt.slice(0, 10) >= earliestDate));

    if (
      pagePosts.length > 0 &&
      pagePosts.every((post) => post.publishedAt.slice(0, 10) < earliestDate)
    ) {
      break;
    }

    nextUrl = readPagingNextUrl(payload);
  }

  return [...new Map(posts.map((item) => [item.id, item])).values()];
}

export async function fetchFacebookPageInsights(
  pageAccessToken: string,
  pageId: string,
  startDate: string,
  endDate: string,
): Promise<FacebookPageInsightsResult> {
  const results = await Promise.allSettled(
    PAGE_INSIGHT_METRICS.map(async (metric) => {
      const points: FacebookPageInsightPoint[] = [];

      for (
        let chunkStart = startDate;
        chunkStart <= endDate;
        chunkStart = addDays(chunkStart, PAGE_INSIGHT_CHUNK_DAYS)
      ) {
        const chunkEnd = minDate(
          addDays(chunkStart, PAGE_INSIGHT_CHUNK_DAYS - 1),
          endDate,
        );
        const url = graphUrl(`/${pageId}/insights`);
        url.searchParams.set("metric", metric);
        url.searchParams.set("period", "day");
        url.searchParams.set("since", chunkStart);
        url.searchParams.set("until", addDays(chunkEnd, 1));
        const payload = await facebookGet(
          url,
          pageAccessToken,
          `Facebook Page insight ${metric}`,
        );
        points.push(...parsePageInsight(payload, metric));
      }

      return points;
    }),
  );
  const points: FacebookPageInsightPoint[] = [];
  const failedMetrics: FacebookPageMetricName[] = [];

  results.forEach((result, index) => {
    const metric = PAGE_INSIGHT_METRICS[index];
    if (!metric) return;

    if (result.status === "fulfilled") {
      points.push(...result.value);
    } else {
      failedMetrics.push(metric);
    }
  });

  return { failedMetrics, points };
}

export async function fetchFacebookPostInsights(
  pageAccessToken: string,
  postId: string,
): Promise<FacebookPostInsights> {
  const url = graphUrl(`/${postId}/insights`);
  url.searchParams.set("metric", POST_INSIGHT_METRICS.join(","));
  const payload = await facebookGet(url, pageAccessToken, "Facebook post insights");
  const values = new Map<string, number>();

  readArray(payload, "data").forEach((item) => {
    if (!isRecord(item)) return;
    const name = optionalString(item, "name");
    if (!name) return;
    const value = readInsightValue(item);
    if (value !== null) values.set(name, value);
  });

  return {
    engagedUsers: values.get("post_engaged_users") ?? 0,
    uniqueViewers: values.get("post_total_media_view_unique") ?? 0,
    views: values.get("post_media_view") ?? 0,
  };
}

function parsePage(page: Record<string, unknown>): FacebookPage {
  const picture = optionalRecord(page, "picture");
  const pictureData = picture ? optionalRecord(picture, "data") : null;

  return {
    accessToken: readString(page, "access_token"),
    fanCount: optionalNonnegativeInteger(page, "fan_count") ?? 0,
    followerCount: optionalNonnegativeInteger(page, "followers_count")
      ?? optionalNonnegativeInteger(page, "fan_count")
      ?? 0,
    id: readIdentifier(page, "id"),
    link: optionalString(page, "link"),
    name: readString(page, "name"),
    pictureUrl: pictureData ? optionalString(pictureData, "url") : null,
    tasks: readOptionalStringArray(page, "tasks"),
    username: optionalString(page, "username"),
  };
}

function parsePost(post: Record<string, unknown>): FacebookPost {
  const attachments = optionalRecord(post, "attachments");
  const attachmentData = attachments ? optionalArray(attachments, "data") : [];
  const attachment = attachmentData.find(isRecord);
  const comments = optionalRecord(post, "comments");
  const reactions = optionalRecord(post, "reactions");
  const shares = optionalRecord(post, "shares");

  return {
    comments: readSummaryTotal(comments),
    contentType: attachment
      ? optionalString(attachment, "media_type") ?? optionalString(attachment, "type") ?? "post"
      : "post",
    id: readIdentifier(post, "id"),
    message: optionalString(post, "message"),
    permalink: optionalString(post, "permalink_url"),
    publishedAt: readDateTime(post, "created_time"),
    reactions: readSummaryTotal(reactions),
    shares: shares ? optionalNonnegativeInteger(shares, "count") ?? 0 : 0,
    thumbnailUrl: optionalString(post, "full_picture"),
  };
}

function parsePageInsight(
  payload: Record<string, unknown>,
  metric: FacebookPageMetricName,
) {
  const points: FacebookPageInsightPoint[] = [];

  readArray(payload, "data").forEach((item) => {
    if (!isRecord(item) || optionalString(item, "name") !== metric) return;

    optionalArray(item, "values").forEach((entry) => {
      if (!isRecord(entry)) return;
      const value = numericValue(entry.value);
      const endTime = optionalString(entry, "end_time");

      if (value !== null && endTime && isValidDate(endTime)) {
        points.push({ date: new Date(endTime).toISOString().slice(0, 10), metric, value });
      }
    });
  });

  return points;
}

function readInsightValue(metric: Record<string, unknown>) {
  for (const entry of optionalArray(metric, "values")) {
    if (!isRecord(entry)) continue;
    const scalar = numericValue(entry.value);
    if (scalar !== null) return scalar;
    if (isRecord(entry.value)) {
      const total = Object.values(entry.value).reduce<number>((sum, value) => {
        const number = numericValue(value);
        return sum + (number ?? 0);
      }, 0);
      return total;
    }
  }

  return null;
}

function readSummaryTotal(value: Record<string, unknown> | null) {
  const summary = value ? optionalRecord(value, "summary") : null;
  return summary ? optionalNonnegativeInteger(summary, "total_count") ?? 0 : 0;
}

async function facebookGet(url: URL, accessToken: string, label: string) {
  return facebookRequest(
    url,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    label,
  );
}

async function facebookRequest(
  input: string | URL,
  init: RequestInit,
  label: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const raw = await response.text();
  let payload: unknown;

  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${label} returned an invalid JSON response.`);
  }

  if (!isRecord(payload)) {
    throw new Error(`${label} returned an invalid response.`);
  }

  const error = optionalRecord(payload, "error");
  if (!response.ok || error) {
    const code = error
      ? String(error.code ?? error.type ?? `HTTP_${response.status}`)
      : `HTTP_${response.status}`;
    const message = error ? optionalString(error, "message") : null;
    throw new Error(`${label} failed (${code}): ${message ?? "Meta rejected the request."}`);
  }

  return payload;
}

function graphUrl(path: string) {
  return new URL(`${FACEBOOK_GRAPH_ORIGIN}/${getFacebookGraphApiVersion()}${path}`);
}

function readPagingNextUrl(payload: Record<string, unknown>) {
  const paging = optionalRecord(payload, "paging");
  const next = paging ? optionalString(paging, "next") : null;
  if (!next) return null;

  const url = new URL(next);
  if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com") {
    throw new Error("Facebook returned an unsafe pagination URL.");
  }

  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`Facebook response is missing ${key}.`);
  return value;
}

function optionalArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function optionalRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Facebook response is missing ${key}.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readIdentifier(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new Error(`Facebook response is missing ${key}.`);
}

function readNonnegativeInteger(record: Record<string, unknown>, key: string) {
  const value = numericValue(record[key]);
  if (value === null) throw new Error(`Facebook response contains an invalid ${key}.`);
  return value;
}

function optionalNonnegativeInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return value === null || value === undefined ? null : readNonnegativeInteger(record, key);
}

function numericValue(value: unknown) {
  const number = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function readOptionalStringArray(record: Record<string, unknown>, key: string) {
  return optionalArray(record, key).filter((value): value is string => typeof value === "string");
}

function readDateTime(record: Record<string, unknown>, key: string) {
  const value = readString(record, key);
  if (!isValidDate(value)) throw new Error(`Facebook response contains an invalid ${key}.`);
  return new Date(value).toISOString();
}

function isValidDate(value: string) {
  return !Number.isNaN(Date.parse(value));
}

function addDays(date: string, numberOfDays: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + numberOfDays);
  return value.toISOString().slice(0, 10);
}

function minDate(left: string, right: string) {
  return left < right ? left : right;
}
