import "server-only";

import { getSiteUrl } from "@/lib/site-url";
import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const facebookScopes = [
  "pages_show_list",
  "pages_read_engagement",
  "read_insights",
];

export function isFacebookConnectorConfigured() {
  return Boolean(
    process.env.FACEBOOK_APP_ID &&
    process.env.FACEBOOK_APP_SECRET &&
    isSupabaseAdminConfigured(),
  );
}

export function getFacebookOAuthConfig() {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("Facebook OAuth credentials are not configured.");
  }

  return {
    appId,
    appSecret,
    redirectUri: new URL("/api/connect/facebook/callback", getSiteUrl()).toString(),
  };
}

export function getFacebookGraphApiVersion() {
  const version = process.env.META_GRAPH_API_VERSION || "v25.0";

  if (!/^v\d+\.\d+$/.test(version)) {
    throw new Error("META_GRAPH_API_VERSION must look like v25.0.");
  }

  return version;
}

export function createFacebookAuthorizationUrl(state: string) {
  const { appId, redirectUri } = getFacebookOAuthConfig();
  const url = new URL(
    `https://www.facebook.com/${getFacebookGraphApiVersion()}/dialog/oauth`,
  );

  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", facebookScopes.join(","));
  url.searchParams.set("state", state);

  return url;
}
