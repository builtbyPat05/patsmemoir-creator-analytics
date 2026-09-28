import "server-only";

import { getSiteUrl } from "@/lib/site-url";
import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const instagramScopes = [
  "instagram_business_basic",
  "instagram_business_manage_insights",
];

export function isInstagramConnectorConfigured() {
  return Boolean(
    process.env.INSTAGRAM_APP_ID &&
    process.env.INSTAGRAM_APP_SECRET &&
    isSupabaseAdminConfigured(),
  );
}

export function getInstagramOAuthConfig() {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("Instagram OAuth credentials are not configured.");
  }

  return {
    appId,
    appSecret,
    redirectUri: new URL("/api/connect/instagram/callback", getSiteUrl()).toString(),
  };
}

export function getMetaGraphApiVersion() {
  const version = process.env.META_GRAPH_API_VERSION || "v25.0";

  if (!/^v\d+\.\d+$/.test(version)) {
    throw new Error("META_GRAPH_API_VERSION must look like v25.0.");
  }

  return version;
}

export function createInstagramAuthorizationUrl(state: string) {
  const { appId, redirectUri } = getInstagramOAuthConfig();
  const url = new URL("https://www.instagram.com/oauth/authorize");

  url.searchParams.set("client_id", appId);
  url.searchParams.set("enable_fb_login", "0");
  url.searchParams.set("force_authentication", "1");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", instagramScopes.join(","));
  url.searchParams.set("state", state);

  return url;
}
