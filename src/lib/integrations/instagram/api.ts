import "server-only";

import {
  getInstagramOAuthConfig,
  getMetaGraphApiVersion,
} from "@/lib/integrations/instagram/config";

const INSTAGRAM_GRAPH_ORIGIN = "https://graph.instagram.com";
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_MEDIA_PAGES = 100;
const ACCOUNT_INSIGHT_METRICS = [
  "views",
  "reach",
  "profile_views",
  "total_interactions",
  "likes",
  "comments",
  "shares",
  "saves",
  "follower_count",
] as const;
const MEDIA_INSIGHT_METRICS = [
  "views",
  "reach",
  "likes",
  "comments",
  "shares",
  "saved",
  "total_interactions",
] as const;
const MEDIA_FIELDS = [
  "id",
  "caption",
  "comments_count",
  "like_count",
  "media_product_type",
  "media_type",
  "media_url",
  "permalink",
  "thumbnail_url",
  "timestamp",
  "username",
];

export type InstagramAccountMetricName = typeof ACCOUNT_INSIGHT_METRICS[number];

export type InstagramToken = {
  accessToken: string;
  expiresAt: string;
  scopes: string[];
  tokenType: string;
  userId: string;
};

export type InstagramProfile = {
  accountType: string | null;
  displayName: string;
  followerCount: number;
  followsCount: number;
  id: string;
  mediaCount: number;
  profilePictureUrl: string | null;
  username: string;
};

export type InstagramMedia = {
  caption: string | null;
  commentsCount: number;
  id: string;
  likeCount: number;
  mediaProductType: string | null;
  mediaType: string;
  mediaUrl: string | null;
  permalink: string | null;
  publishedAt: string;
  thumbnailUrl: string | null;
};

export type InstagramAccountInsightPoint = {
  date: string;
  metric: InstagramAccountMetricName;
  value: number;
};

export type InstagramAccountInsightsResult = {
  failedMetrics: InstagramAccountMetricName[];
  points: InstagramAccountInsightPoint[];
};

export type InstagramMediaInsights = {
  comments: number;
  likes: number;
  reach: number;
  saves: number;
  shares: number;
  totalInteractions: number;
  views: number;
};

export async function exchangeInstagramCode(code: string): Promise<InstagramToken> {
  const { appId, appSecret, redirectUri } = getInstagramOAuthConfig();
  const shortPayload = await instagramRequest(
    "https://api.instagram.com/oauth/access_token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    },
    "Instagram token exchange",
  );
  const shortAccessToken = readString(shortPayload, "access_token");
  const userId = readIdentifier(shortPayload, "user_id");
  const scopes = readScopes(shortPayload);
  const longUrl = new URL(`${INSTAGRAM_GRAPH_ORIGIN}/access_token`);
  longUrl.searchParams.set("access_token", shortAccessToken);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  const longPayload = await instagramRequest(
    longUrl,
    { method: "GET" },
    "Instagram long-lived token exchange",
  );
  const expiresIn = readNonnegativeInteger(longPayload, "expires_in");

  return {
    accessToken: readString(longPayload, "access_token"),
    expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    scopes,
    tokenType: optionalString(longPayload, "token_type") ?? "Bearer",
    userId,
  };
}

export async function refreshInstagramToken(
  accessToken: string,
  userId: string,
  scopes: string[],
): Promise<InstagramToken> {
  const url = new URL(`${INSTAGRAM_GRAPH_ORIGIN}/refresh_access_token`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("grant_type", "ig_refresh_token");
  const payload = await instagramRequest(
    url,
    { method: "GET" },
    "Instagram token refresh",
  );
  const expiresIn = readNonnegativeInteger(payload, "expires_in");

  return {
    accessToken: readString(payload, "access_token"),
    expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    scopes,
    tokenType: optionalString(payload, "token_type") ?? "Bearer",
    userId,
  };
}

export async function fetchInstagramProfile(
  accessToken: string,
  userId: string,
): Promise<InstagramProfile> {
  const url = graphUrl(`/${userId}`);
  url.searchParams.set(
    "fields",
    "id,user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count",
  );
  const profile = await instagramGet(url, accessToken, "Instagram profile");
  const username = readString(profile, "username");

  return {
    id: readIdentifier(profile, "id"),
    username,
    displayName: optionalString(profile, "name") ?? username,
    accountType: optionalString(profile, "account_type"),
    profilePictureUrl: optionalString(profile, "profile_picture_url"),
    followerCount: readNonnegativeInteger(profile, "followers_count"),
    followsCount: optionalNonnegativeInteger(profile, "follows_count") ?? 0,
    mediaCount: readNonnegativeInteger(profile, "media_count"),
  };
}

export async function fetchInstagramMedia(
  accessToken: string,
  userId: string,
  earliestDate: string,
): Promise<InstagramMedia[]> {
  const media: InstagramMedia[] = [];
  let nextUrl: URL | null = graphUrl(`/${userId}/media`);
  nextUrl.searchParams.set("fields", MEDIA_FIELDS.join(","));
  nextUrl.searchParams.set("limit", "100");

  for (let page = 0; page < MAX_MEDIA_PAGES && nextUrl; page += 1) {
    const payload = await instagramGet(nextUrl, accessToken, "Instagram media");
    const pageMedia = readArray(payload, "data")
      .filter(isRecord)
      .map(parseMedia);
    media.push(...pageMedia.filter((item) => item.publishedAt.slice(0, 10) >= earliestDate));

    if (
      pageMedia.length > 0 &&
      pageMedia.every((item) => item.publishedAt.slice(0, 10) < earliestDate)
    ) {
      break;
    }

    nextUrl = readPagingNextUrl(payload);
  }

  return [...new Map(media.map((item) => [item.id, item])).values()];
}

export async function fetchInstagramAccountInsights(
  accessToken: string,
  userId: string,
  startDate: string,
  endDate: string,
): Promise<InstagramAccountInsightsResult> {
  const results = await Promise.allSettled(
    ACCOUNT_INSIGHT_METRICS.map(async (metric) => {
      const url = graphUrl(`/${userId}/insights`);
      url.searchParams.set("metric", metric);
      url.searchParams.set("period", "day");
      url.searchParams.set("since", String(dateToUnixSeconds(startDate)));
      url.searchParams.set("until", String(dateToUnixSeconds(addDays(endDate, 1))));
      const payload = await instagramGet(
        url,
        accessToken,
        `Instagram account insight ${metric}`,
      );
      return parseAccountInsight(payload, metric);
    }),
  );
  const points: InstagramAccountInsightPoint[] = [];
  const failedMetrics: InstagramAccountMetricName[] = [];

  results.forEach((result, index) => {
    const metric = ACCOUNT_INSIGHT_METRICS[index];
    if (!metric) return;

    if (result.status === "fulfilled") {
      points.push(...result.value);
    } else {
      failedMetrics.push(metric);
    }
  });

  return { failedMetrics, points };
}

export async function fetchInstagramMediaInsights(
  accessToken: string,
  mediaId: string,
): Promise<InstagramMediaInsights> {
  const url = graphUrl(`/${mediaId}/insights`);
  url.searchParams.set("metric", MEDIA_INSIGHT_METRICS.join(","));
  const payload = await instagramGet(url, accessToken, "Instagram media insights");
  const values = new Map<string, number>();

  readArray(payload, "data").forEach((item) => {
    if (!isRecord(item)) return;
    const name = optionalString(item, "name");
    if (!name) return;
    const value = readInsightValue(item);
    if (value !== null) values.set(name, value);
  });

  return {
    views: values.get("views") ?? 0,
    reach: values.get("reach") ?? 0,
    likes: values.get("likes") ?? 0,
    comments: values.get("comments") ?? 0,
    shares: values.get("shares") ?? 0,
    saves: values.get("saved") ?? 0,
    totalInteractions: values.get("total_interactions") ?? 0,
  };
}

function parseMedia(media: Record<string, unknown>): InstagramMedia {
  return {
    id: readIdentifier(media, "id"),
    caption: optionalString(media, "caption"),
    commentsCount: optionalNonnegativeInteger(media, "comments_count") ?? 0,
    likeCount: optionalNonnegativeInteger(media, "like_count") ?? 0,
    mediaProductType: optionalString(media, "media_product_type"),
    mediaType: readString(media, "media_type"),
    mediaUrl: optionalString(media, "media_url"),
    permalink: optionalString(media, "permalink"),
    publishedAt: readDateTime(media, "timestamp"),
    thumbnailUrl: optionalString(media, "thumbnail_url"),
  };
}

function parseAccountInsight(
  payload: Record<string, unknown>,
  metric: InstagramAccountMetricName,
) {
  const points: InstagramAccountInsightPoint[] = [];

  readArray(payload, "data").forEach((item) => {
    if (!isRecord(item) || optionalString(item, "name") !== metric) return;

    readArray(item, "values").forEach((entry) => {
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
  const values = metric.values;

  if (Array.isArray(values)) {
    for (const entry of values) {
      if (isRecord(entry)) {
        const value = numericValue(entry.value);
        if (value !== null) return value;
      }
    }
  }

  const totalValue = optionalRecord(metric, "total_value");
  return totalValue ? numericValue(totalValue.value) : null;
}

async function instagramGet(url: URL, accessToken: string, label: string) {
  return instagramRequest(
    url,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    label,
  );
}

async function instagramRequest(
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
  const legacyErrorType = optionalString(payload, "error_type");

  if (!response.ok || error || legacyErrorType) {
    const code = error
      ? String(error.code ?? error.type ?? `HTTP_${response.status}`)
      : legacyErrorType ?? `HTTP_${response.status}`;
    const message = error
      ? optionalString(error, "message")
      : optionalString(payload, "error_message");
    throw new Error(`${label} failed (${code}): ${message ?? "Meta rejected the request."}`);
  }

  return payload;
}

function graphUrl(path: string) {
  return new URL(`${INSTAGRAM_GRAPH_ORIGIN}/${getMetaGraphApiVersion()}${path}`);
}

function readPagingNextUrl(payload: Record<string, unknown>) {
  const paging = optionalRecord(payload, "paging");
  const next = paging ? optionalString(paging, "next") : null;

  if (!next) return null;

  const url = new URL(next);
  if (url.protocol !== "https:" || url.hostname !== "graph.instagram.com") {
    throw new Error("Instagram returned an unsafe pagination URL.");
  }

  return url;
}

function readScopes(payload: Record<string, unknown>) {
  const permissions = payload.permissions;

  if (Array.isArray(permissions)) {
    return permissions.filter((value): value is string => typeof value === "string");
  }

  const scope = optionalString(payload, "scope");
  return scope ? scope.split(",").map((value) => value.trim()).filter(Boolean) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readArray(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (!Array.isArray(value)) {
    throw new Error(`Instagram response is missing ${key}.`);
  }

  return value;
}

function optionalRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Instagram response is missing ${key}.`);
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

  throw new Error(`Instagram response is missing ${key}.`);
}

function readNonnegativeInteger(record: Record<string, unknown>, key: string) {
  const value = numericValue(record[key]);

  if (value === null) {
    throw new Error(`Instagram response contains an invalid ${key}.`);
  }

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

function readDateTime(record: Record<string, unknown>, key: string) {
  const value = readString(record, key);

  if (!isValidDate(value)) {
    throw new Error(`Instagram response contains an invalid ${key}.`);
  }

  return new Date(value).toISOString();
}

function isValidDate(value: string) {
  return !Number.isNaN(Date.parse(value));
}

function dateToUnixSeconds(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 1_000);
}

function addDays(date: string, numberOfDays: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + numberOfDays);
  return value.toISOString().slice(0, 10);
}
