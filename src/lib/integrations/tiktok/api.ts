import "server-only";

import { getTikTokOAuthConfig } from "@/lib/integrations/tiktok/config";

const TIKTOK_API = "https://open.tiktokapis.com/v2";
const REQUEST_TIMEOUT_MS = 20_000;
const VIDEO_PAGE_SIZE = 20;
const MAX_VIDEO_PAGES = 500;
const USER_FIELDS = [
  "open_id",
  "union_id",
  "avatar_url",
  "display_name",
  "follower_count",
  "following_count",
  "likes_count",
  "video_count",
];
const VIDEO_FIELDS = [
  "id",
  "create_time",
  "cover_image_url",
  "share_url",
  "video_description",
  "duration",
  "title",
  "like_count",
  "comment_count",
  "share_count",
  "view_count",
];

export type TikTokToken = {
  accessToken: string;
  expiresAt: string;
  openId: string;
  refreshExpiresAt: string;
  refreshToken: string;
  scopes: string[];
  tokenType: string;
};

export type TikTokUser = {
  avatarUrl: string | null;
  displayName: string;
  followerCount: number;
  followingCount: number;
  likesCount: number;
  openId: string;
  unionId: string | null;
  videoCount: number;
};

export type TikTokVideo = {
  commentCount: number;
  coverImageUrl: string | null;
  description: string | null;
  durationSeconds: number | null;
  id: string;
  likeCount: number;
  publishedAt: string;
  shareCount: number;
  shareUrl: string | null;
  title: string | null;
  viewCount: number;
};

export async function exchangeTikTokCode(code: string): Promise<TikTokToken> {
  const { clientKey, clientSecret, redirectUri } = getTikTokOAuthConfig();
  const payload = await tiktokRequest(
    `${TIKTOK_API}/oauth/token/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    },
    "TikTok token exchange",
  );

  return parseToken(payload);
}

export async function refreshTikTokToken(refreshToken: string): Promise<TikTokToken> {
  const { clientKey, clientSecret } = getTikTokOAuthConfig();
  const payload = await tiktokRequest(
    `${TIKTOK_API}/oauth/token/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    },
    "TikTok token refresh",
  );

  return parseToken(payload);
}

export async function fetchTikTokUser(accessToken: string): Promise<TikTokUser> {
  const url = new URL(`${TIKTOK_API}/user/info/`);
  url.searchParams.set("fields", USER_FIELDS.join(","));
  const payload = await tiktokRequest(
    url,
    { headers: bearerHeaders(accessToken) },
    "TikTok user profile",
  );
  const data = readRecord(payload, "data");
  const user = readRecord(data, "user");

  return {
    openId: readString(user, "open_id"),
    unionId: optionalString(user, "union_id"),
    avatarUrl: optionalString(user, "avatar_url"),
    displayName: readString(user, "display_name"),
    followerCount: readNonnegativeInteger(user, "follower_count"),
    followingCount: readNonnegativeInteger(user, "following_count"),
    likesCount: readNonnegativeInteger(user, "likes_count"),
    videoCount: readNonnegativeInteger(user, "video_count"),
  };
}

export async function fetchTikTokVideos(accessToken: string): Promise<TikTokVideo[]> {
  const videos: TikTokVideo[] = [];
  const seenCursors = new Set<number>();
  let cursor: number | null = null;

  for (let page = 0; page < MAX_VIDEO_PAGES; page += 1) {
    const url = new URL(`${TIKTOK_API}/video/list/`);
    url.searchParams.set("fields", VIDEO_FIELDS.join(","));
    const body: { cursor?: number; max_count: number } = {
      max_count: VIDEO_PAGE_SIZE,
    };

    if (cursor !== null) {
      body.cursor = cursor;
    }

    const payload = await tiktokRequest(
      url,
      {
        method: "POST",
        headers: {
          ...bearerHeaders(accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      "TikTok video list",
    );
    const data = readRecord(payload, "data");

    readArray(data, "videos").forEach((item) => {
      if (isRecord(item)) {
        videos.push(parseVideo(item));
      }
    });

    if (!readBoolean(data, "has_more")) {
      return deduplicateVideos(videos);
    }

    const nextCursor = readNonnegativeInteger(data, "cursor");

    if (seenCursors.has(nextCursor)) {
      throw new Error("TikTok video pagination returned a repeated cursor.");
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error(`TikTok returned more than ${MAX_VIDEO_PAGES * VIDEO_PAGE_SIZE} videos in one sync.`);
}

function parseToken(payload: Record<string, unknown>): TikTokToken {
  const expiresIn = readNonnegativeInteger(payload, "expires_in");
  const refreshExpiresIn = readNonnegativeInteger(payload, "refresh_expires_in");

  return {
    accessToken: readString(payload, "access_token"),
    expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    openId: readString(payload, "open_id"),
    refreshExpiresAt: new Date(Date.now() + refreshExpiresIn * 1_000).toISOString(),
    refreshToken: readString(payload, "refresh_token"),
    scopes: readString(payload, "scope").split(",").map((scope) => scope.trim()).filter(Boolean),
    tokenType: optionalString(payload, "token_type") ?? "Bearer",
  };
}

function parseVideo(video: Record<string, unknown>): TikTokVideo {
  const createTime = readNonnegativeInteger(video, "create_time");

  return {
    id: readString(video, "id"),
    publishedAt: new Date(createTime * 1_000).toISOString(),
    coverImageUrl: optionalString(video, "cover_image_url"),
    shareUrl: optionalString(video, "share_url"),
    description: optionalString(video, "video_description"),
    durationSeconds: optionalNonnegativeInteger(video, "duration"),
    title: optionalString(video, "title"),
    likeCount: readNonnegativeInteger(video, "like_count"),
    commentCount: readNonnegativeInteger(video, "comment_count"),
    shareCount: readNonnegativeInteger(video, "share_count"),
    viewCount: readNonnegativeInteger(video, "view_count"),
  };
}

async function tiktokRequest(
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

  const topLevelError = optionalString(payload, "error");
  const nestedError = optionalRecord(payload, "error");
  const nestedCode = nestedError ? optionalString(nestedError, "code") : null;
  const hasNestedError = nestedCode !== null && nestedCode !== "ok";

  if (!response.ok || topLevelError || hasNestedError) {
    const code = topLevelError || nestedCode || `HTTP_${response.status}`;
    const message = optionalString(payload, "error_description")
      || (nestedError ? optionalString(nestedError, "message") : null)
      || "The provider rejected the request.";
    throw new Error(`${label} failed (${code}): ${message}`);
  }

  return payload;
}

function bearerHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

function deduplicateVideos(videos: TikTokVideo[]) {
  return [...new Map(videos.map((video) => [video.id, video])).values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (!isRecord(value)) {
    throw new Error(`TikTok response is missing ${key}.`);
  }

  return value;
}

function optionalRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function readArray(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (!Array.isArray(value)) {
    throw new Error(`TikTok response is missing ${key}.`);
  }

  return value;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`TikTok response is missing ${key}.`);
  }

  return value;
}

function optionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBoolean(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (typeof value !== "boolean") {
    throw new Error(`TikTok response is missing ${key}.`);
  }

  return value;
}

function readNonnegativeInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];
  const numericValue = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : Number.NaN;

  if (!Number.isSafeInteger(numericValue) || numericValue < 0) {
    throw new Error(`TikTok response contains an invalid ${key}.`);
  }

  return numericValue;
}

function optionalNonnegativeInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (value === null || value === undefined) {
    return null;
  }

  return readNonnegativeInteger(record, key);
}
