import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { exchangeYoutubeCode } from "@/lib/integrations/youtube/api";
import { connectYoutubeAccount } from "@/lib/integrations/youtube/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");

  if (requestUrl.searchParams.get("error")) {
    return redirectToConnections(requestUrl, { error: "youtube_access_denied" });
  }

  if (!code || !state) {
    return redirectToConnections(requestUrl, { error: "youtube_callback_invalid" });
  }

  try {
    const admin = createAdminClient();
    const stateHash = createHash("sha256").update(state).digest("hex");
    const { data: connectionState, error: stateError } = await admin
      .from("oauth_connection_states")
      .delete()
      .eq("state_hash", stateHash)
      .eq("platform", "youtube")
      .select("owner_id, return_path, expires_at")
      .maybeSingle();

    if (
      stateError ||
      !connectionState ||
      Date.parse(connectionState.expires_at) <= Date.now()
    ) {
      return redirectToConnections(requestUrl, { error: "youtube_state_invalid" });
    }

    const token = await exchangeYoutubeCode(code);
    const result = await connectYoutubeAccount(connectionState.owner_id, token);

    return redirectToConnections(requestUrl, {
      connected: "youtube",
      sync: result.status,
    }, connectionState.return_path);
  } catch (error) {
    console.error(
      "[youtube] OAuth callback failed.",
      error instanceof Error ? error.message : error,
    );
    return redirectToConnections(requestUrl, { error: "youtube_connection_failed" });
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
