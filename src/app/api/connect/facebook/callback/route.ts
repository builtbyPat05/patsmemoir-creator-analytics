import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  exchangeFacebookCode,
  fetchFacebookPages,
} from "@/lib/integrations/facebook/api";
import { connectFacebookPages } from "@/lib/integrations/facebook/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");

  if (requestUrl.searchParams.get("error")) {
    return redirectToConnections(requestUrl, { error: "facebook_access_denied" });
  }

  if (!code || !state) {
    return redirectToConnections(requestUrl, { error: "facebook_callback_invalid" });
  }

  try {
    const admin = createAdminClient();
    const stateHash = createHash("sha256").update(state).digest("hex");
    const { data: connectionState, error: stateError } = await admin
      .from("oauth_connection_states")
      .delete()
      .eq("state_hash", stateHash)
      .eq("platform", "facebook")
      .select("owner_id, return_path, expires_at")
      .maybeSingle();

    if (
      stateError ||
      !connectionState ||
      Date.parse(connectionState.expires_at) <= Date.now()
    ) {
      return redirectToConnections(requestUrl, { error: "facebook_state_invalid" });
    }

    const userToken = await exchangeFacebookCode(code);
    const pages = (await fetchFacebookPages(userToken.accessToken)).filter(
      (page) => page.tasks.length === 0 || page.tasks.includes("ANALYZE"),
    );
    const result = await connectFacebookPages(
      connectionState.owner_id,
      userToken,
      pages,
    );

    return redirectToConnections(
      requestUrl,
      { connected: "facebook", sync: result.status },
      connectionState.return_path,
    );
  } catch (error) {
    console.error(
      "[facebook] OAuth callback failed.",
      error instanceof Error ? error.message : error,
    );
    return redirectToConnections(requestUrl, { error: "facebook_connection_failed" });
  }
}

function redirectToConnections(
  requestUrl: URL,
  parameters: Record<string, string>,
  path = "/settings/connections",
) {
  const connectionsUrl = new URL(path, requestUrl.origin);
  Object.entries(parameters).forEach(([key, value]) => {
    connectionsUrl.searchParams.set(key, value);
  });
  return NextResponse.redirect(connectionsUrl);
}
