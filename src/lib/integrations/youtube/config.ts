import "server-only";

import { getSiteUrl } from "@/lib/site-url";
import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const youtubeScopes = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

export function isYoutubeConnectorConfigured() {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    isSupabaseAdminConfigured(),
  );
}

export function getYoutubeOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured.");
  }

  return {
    clientId,
    clientSecret,
    redirectUri: new URL("/api/connect/youtube/callback", getSiteUrl()).toString(),
  };
}

export function createYoutubeAuthorizationUrl(state: string) {
  const { clientId, redirectUri } = getYoutubeOAuthConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("access_type", "offline");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", youtubeScopes.join(" "));
  url.searchParams.set("state", state);

  return url;
}
