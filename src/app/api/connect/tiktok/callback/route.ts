import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { exchangeTikTokCode } from "@/lib/integrations/tiktok/api";
import { connectTikTokAccount } from "@/lib/integrations/tiktok/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");

  if (requestUrl.searchParams.get("error")) {
    return redirectToConnections(requestUrl, { error: "tiktok_access_denied" });
  }

  if (!code || !state) {
    return redirectToConnections(requestUrl, { error: "tiktok_callback_invalid" });
  }

  try {
    const admin = createAdminClient();
    const stateHash = createHash("sha256").update(state).digest("hex");
    const { data: connectionState, error: stateError } = await admin
      .from("oauth_connection_states")
      .delete()
      .eq("state_hash", stateHash)
      .eq("platform", "tiktok")
      .select("owner_id, return_path, expires_at")
      .maybeSingle();

    if (
      stateError ||
      !connectionState ||
      Date.parse(connectionState.expires_at) <= Date.now()
    ) {
      return redirectToConnections(requestUrl, { error: "tiktok_state_invalid" });
    }

    const token = await exchangeTikTokCode(code);
    const result = await connectTikTokAccount(connectionState.owner_id, token);

    return redirectToConnections(requestUrl, {
      connected: "tiktok",
      sync: result.status,
    }, connectionState.return_path);
  } catch (error) {
    console.error(
      "[tiktok] OAuth callback failed.",
      error instanceof Error ? error.message : error,
    );
    return redirectToConnections(requestUrl, { error: "tiktok_connection_failed" });
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
