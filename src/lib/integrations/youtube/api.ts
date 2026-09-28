import "server-only";

import { getYoutubeOAuthConfig } from "@/lib/integrations/youtube/config";

const YOUTUBE_DATA_API = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";
const REPORT_PAGE_SIZE = 200;
const REPORT_ROW_LIMIT = 50_000;

export type YoutubeToken = {
  accessToken: string;
  expiresAt: string;
  refreshToken: string | null;
  scopes: string[];
  tokenType: string;
};

export type YoutubeChannel = {
  avatarUrl: string | null;
  customUrl: string | null;
  id: string;
  subscriberCount: number;
  title: string;
  uploadsPlaylistId: string | null;
  videoCount: number;
  viewCount: number;
};

export type YoutubeChannelDay = {
  comments: number;
  date: string;
  estimatedMinutesWatched: number;
  likes: number;
  shares: number;
  subscribersGained: number;
  subscribersLost: number;
  views: number;
};

export type YoutubeVideoDay = {
  comments: number;
  date: string;
  likes: number;
  shares: number;
  videoId: string;
  views: number;
};

export type YoutubeVideo = {
  durationSeconds: number | null;
  id: string;
  publishedAt: string;
  statistics: {
    commentCount: number;
    likeCount: number;
    viewCount: number;
  };
  thumbnailUrl: string | null;
  title: string;
};

type YoutubeReport = {
  columnHeaders?: { name?: string }[];
  rows?: unknown[][];
};

export async function exchangeYoutubeCode(code: string): Promise<YoutubeToken> {
  const { clientId, clientSecret, redirectUri } = getYoutubeOAuthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  const payload = await readJson(response, "Google token exchange");
  const accessToken = readString(payload, "access_token");
  const expiresIn = readNumber(payload, "expires_in");
  const scope = optionalString(payload, "scope") ?? "";

  return {
    accessToken,
    expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    refreshToken: optionalString(payload, "refresh_token"),
    scopes: scope.split(" ").filter(Boolean),
    tokenType: optionalString(payload, "token_type") ?? "Bearer",
  };
}

export async function refreshYoutubeToken(refreshToken: string): Promise<YoutubeToken> {
  const { clientId, clientSecret } = getYoutubeOAuthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  const payload = await readJson(response, "Google token refresh");
  const accessToken = readString(payload, "access_token");
  const expiresIn = readNumber(payload, "expires_in");
  const scope = optionalString(payload, "scope") ?? "";

  return {
    accessToken,
    expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    refreshToken,
    scopes: scope.split(" ").filter(Boolean),
    tokenType: optionalString(payload, "token_type") ?? "Bearer",
  };
}

export async function fetchYoutubeChannel(accessToken: string): Promise<YoutubeChannel> {
  const url = new URL(`${YOUTUBE_DATA_API}/channels`);
  url.searchParams.set("mine", "true");
  url.searchParams.set("part", "id,snippet,statistics,contentDetails");
  const payload = await youtubeGet(url, accessToken, "YouTube channel");
  const item = readArray(payload, "items")[0];

  if (!isRecord(item)) {
    throw new Error("No YouTube channel is associated with the selected Google account.");
  }

  const snippet = readRecord(item, "snippet");
  const statistics = readRecord(item, "statistics");
  const contentDetails = readRecord(item, "contentDetails");
  const relatedPlaylists = optionalRecord(contentDetails, "relatedPlaylists");
  const thumbnails = optionalRecord(snippet, "thumbnails");
  const defaultThumbnail = thumbnails ? optionalRecord(thumbnails, "default") : null;

  return {
    id: readString(item, "id"),
    title: readString(snippet, "title"),
    customUrl: optionalString(snippet, "customUrl"),
    avatarUrl: defaultThumbnail ? optionalString(defaultThumbnail, "url") : null,
    subscriberCount: numericString(statistics, "subscriberCount"),
    videoCount: numericString(statistics, "videoCount"),
    viewCount: numericString(statistics, "viewCount"),
    uploadsPlaylistId: relatedPlaylists
      ? optionalString(relatedPlaylists, "uploads")
      : null,
  };
}

export async function fetchYoutubeChannelDays(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<YoutubeChannelDay[]> {
  const rows = await fetchReportRows(accessToken, {
    dimensions: "day",
    endDate,
    metrics: "views,likes,comments,shares,subscribersGained,subscribersLost,estimatedMinutesWatched",
    sort: "day",
    startDate,
  });

  return rows.map((row) => ({
    date: reportString(row, "day"),
    views: reportNumber(row, "views"),
    likes: reportNumber(row, "likes"),
    comments: reportNumber(row, "comments"),
    shares: reportNumber(row, "shares"),
    subscribersGained: reportNumber(row, "subscribersGained"),
    subscribersLost: reportNumber(row, "subscribersLost"),
    estimatedMinutesWatched: reportNumber(row, "estimatedMinutesWatched"),
  }));
}

export async function fetchYoutubeVideoDays(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<YoutubeVideoDay[]> {
  const rows = await fetchReportRows(
    accessToken,
    {
      dimensions: "day,video",
      endDate,
      metrics: "views,likes,comments,shares",
      sort: "day",
      startDate,
    },
    true,
  );

  return rows.map((row) => ({
    date: reportString(row, "day"),
    videoId: reportString(row, "video"),
    views: reportNumber(row, "views"),
    likes: reportNumber(row, "likes"),
    comments: reportNumber(row, "comments"),
    shares: reportNumber(row, "shares"),
  }));
}

export async function fetchYoutubeVideos(
  accessToken: string,
  videoIds: string[],
): Promise<YoutubeVideo[]> {
  const videos: YoutubeVideo[] = [];

  for (let offset = 0; offset < videoIds.length; offset += 50) {
    const ids = videoIds.slice(offset, offset + 50);
    const url = new URL(`${YOUTUBE_DATA_API}/videos`);
    url.searchParams.set("id", ids.join(","));
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("part", "id,snippet,statistics,contentDetails");
    const payload = await youtubeGet(url, accessToken, "YouTube videos");

    readArray(payload, "items").forEach((item) => {
      if (!isRecord(item)) {
        return;
      }

      const snippet = readRecord(item, "snippet");
      const statistics = optionalRecord(item, "statistics");
      const contentDetails = optionalRecord(item, "contentDetails");
      const thumbnails = optionalRecord(snippet, "thumbnails");

      videos.push({
        id: readString(item, "id"),
        title: readString(snippet, "title"),
        publishedAt: readString(snippet, "publishedAt"),
        thumbnailUrl: pickThumbnail(thumbnails),
        durationSeconds: contentDetails
          ? parseYoutubeDuration(optionalString(contentDetails, "duration"))
          : null,
        statistics: {
          viewCount: statistics ? numericString(statistics, "viewCount") : 0,
          likeCount: statistics ? numericString(statistics, "likeCount") : 0,
          commentCount: statistics ? numericString(statistics, "commentCount") : 0,
        },
      });
    });
  }

  return videos;
}

export async function fetchYoutubeUploadIds(
  accessToken: string,
  playlistId: string,
  startDate: string,
) {
  const videoIds: string[] = [];
  let pageToken: string | null = null;

  for (;;) {
    const url = new URL(`${YOUTUBE_DATA_API}/playlistItems`);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("part", "contentDetails,snippet");
    url.searchParams.set("playlistId", playlistId);

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const payload = await youtubeGet(url, accessToken, "YouTube uploads");
    const items = readArray(payload, "items");
    let reachedOlderVideo = false;

    items.forEach((item) => {
      if (!isRecord(item)) return;
      const snippet = optionalRecord(item, "snippet");
      const contentDetails = optionalRecord(item, "contentDetails");
      const publishedAt = snippet ? optionalString(snippet, "publishedAt") : null;
      const videoId = contentDetails ? optionalString(contentDetails, "videoId") : null;

      if (publishedAt && publishedAt.slice(0, 10) < startDate) {
        reachedOlderVideo = true;
        return;
      }

      if (videoId) {
        videoIds.push(videoId);
      }
    });

    pageToken = optionalString(payload, "nextPageToken");

    if (!pageToken || reachedOlderVideo) {
      return videoIds;
    }
  }
}

async function fetchReportRows(
  accessToken: string,
  parameters: Record<string, string>,
  paginate = false,
) {
  const allRows: Record<string, unknown>[] = [];
  let startIndex = 1;

  for (;;) {
    const url = new URL(YOUTUBE_ANALYTICS_API);
    Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set("ids", "channel==MINE");

    if (paginate) {
      url.searchParams.set("maxResults", String(REPORT_PAGE_SIZE));
      url.searchParams.set("startIndex", String(startIndex));
    }

    const payload = await youtubeGet(url, accessToken, "YouTube Analytics report");
    const report = payload as YoutubeReport;
    const columns = (report.columnHeaders ?? []).map((column) => column.name ?? "");
    const pageRows = (report.rows ?? []).map((values) =>
      Object.fromEntries(columns.map((column, index) => [column, values[index]])),
    );
    allRows.push(...pageRows);

    if (
      !paginate ||
      pageRows.length < REPORT_PAGE_SIZE ||
      allRows.length >= REPORT_ROW_LIMIT
    ) {
      return allRows.slice(0, REPORT_ROW_LIMIT);
    }

    startIndex += pageRows.length;
  }
}

async function youtubeGet(url: URL, accessToken: string, label: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  return readJson(response, label);
}

async function readJson(response: Response, label: string): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const apiMessage = isRecord(payload)
      ? optionalString(optionalRecord(payload, "error") ?? {}, "message")
      : null;
    throw new Error(`${label} failed${apiMessage ? `: ${apiMessage}` : "."}`);
  }

  if (!isRecord(payload)) {
    throw new Error(`${label} returned an invalid response.`);
  }

  return payload;
}

function readRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`YouTube response is missing ${key}.`);
  return value;
}

function optionalRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function readArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`YouTube response is missing ${key}.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Google response is missing ${key}.`);
  }
  return value;
}

function numericString(record: Record<string, unknown>, key: string) {
  const value = Number(record[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function reportString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function reportNumber(row: Record<string, unknown>, key: string) {
  const value = Number(row[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function pickThumbnail(thumbnails: Record<string, unknown> | null) {
  if (!thumbnails) return null;

  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    const thumbnail = optionalRecord(thumbnails, key);
    const url = thumbnail ? optionalString(thumbnail, "url") : null;
    if (url) return url;
  }

  return null;
}

function parseYoutubeDuration(value: string | null) {
  if (!value) return null;
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return null;

  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
