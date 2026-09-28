import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createTikTokAuthorizationUrl,
  isTikTokConnectorConfigured,
} from "@/lib/integrations/tiktok/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  if (!isTikTokConnectorConfigured()) {
    return redirectToConnections(requestUrl, "tiktok_not_configured");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    const loginUrl = new URL("/login", requestUrl.origin);
    loginUrl.searchParams.set("next", "/settings/connections");
    return NextResponse.redirect(loginUrl);
  }

  const state = randomBytes(32).toString("base64url");
  const stateHash = createHash("sha256").update(state).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1_000).toISOString();
  const admin = createAdminClient();

  await admin
    .from("oauth_connection_states")
    .delete()
    .lt("expires_at", new Date().toISOString());

  const { error: stateError } = await admin.from("oauth_connection_states").insert({
    owner_id: data.user.id,
    platform: "tiktok",
    state_hash: stateHash,
    return_path: "/settings/connections",
    expires_at: expiresAt,
  });

  if (stateError) {
    console.error("[tiktok] Unable to create OAuth state.", stateError.message);
    return redirectToConnections(requestUrl, "tiktok_state_failed");
  }

  return NextResponse.redirect(createTikTokAuthorizationUrl(state));
}

function redirectToConnections(requestUrl: URL, error: string) {
  const connectionsUrl = new URL("/settings/connections", requestUrl.origin);
  connectionsUrl.searchParams.set("error", error);
  return NextResponse.redirect(connectionsUrl);
}
