import "server-only";

import { getSiteUrl } from "@/lib/site-url";
import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const tiktokScopes = [
  "user.info.basic",
  "user.info.stats",
  "video.list",
];

export function isTikTokConnectorConfigured() {
  return Boolean(
    process.env.TIKTOK_CLIENT_KEY &&
    process.env.TIKTOK_CLIENT_SECRET &&
    isSupabaseAdminConfigured(),
  );
}

export function getTikTokOAuthConfig() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    throw new Error("TikTok OAuth credentials are not configured.");
  }

  return {
    clientKey,
    clientSecret,
    redirectUri: new URL("/api/connect/tiktok/callback", getSiteUrl()).toString(),
  };
}

export function createTikTokAuthorizationUrl(state: string) {
  const { clientKey, redirectUri } = getTikTokOAuthConfig();
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");

  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", tiktokScopes.join(","));
  url.searchParams.set("state", state);

  return url;
}
