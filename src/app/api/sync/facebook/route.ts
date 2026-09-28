import { NextResponse } from "next/server";
import { syncAllFacebookAccounts } from "@/lib/integrations/facebook/sync";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    const loginUrl = new URL("/login", requestUrl.origin);
    loginUrl.searchParams.set("next", "/settings/connections");
    return NextResponse.redirect(loginUrl, 303);
  }

  try {
    const result = await syncAllFacebookAccounts(data.user.id, "manual");
    const connectionsUrl = new URL("/settings/connections", requestUrl.origin);
    connectionsUrl.searchParams.set("synced", "facebook");
    connectionsUrl.searchParams.set("sync", result.status);
    return NextResponse.redirect(connectionsUrl, 303);
  } catch (syncError) {
    console.error(
      "[facebook] Manual sync failed.",
      syncError instanceof Error ? syncError.message : syncError,
    );
    return redirectToConnections(requestUrl, "facebook_sync_failed");
  }
}

function redirectToConnections(requestUrl: URL, error: string) {
  const connectionsUrl = new URL("/settings/connections", requestUrl.origin);
  connectionsUrl.searchParams.set("error", error);
  return NextResponse.redirect(connectionsUrl, 303);
}
