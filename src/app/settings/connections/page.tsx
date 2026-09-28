import {
  Check,
  CircleAlert,
  Facebook,
  Instagram,
  Link2,
  LockKeyhole,
  Music2,
  RefreshCw,
  Youtube,
} from "lucide-react";
import Link from "next/link";
import { Sidebar } from "@/components/dashboard/sidebar";
import { isFacebookConnectorConfigured } from "@/lib/integrations/facebook/config";
import { isInstagramConnectorConfigured } from "@/lib/integrations/instagram/config";
import { isTikTokConnectorConfigured } from "@/lib/integrations/tiktok/config";
import { isYoutubeConnectorConfigured } from "@/lib/integrations/youtube/config";
import { platformKeys, platforms } from "@/lib/dashboard-data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const platformIcons = {
  youtube: Youtube,
  instagram: Instagram,
  facebook: Facebook,
  tiktok: Music2,
};

const noticeMessages: Record<string, string> = {
  youtube_not_configured: "YouTube needs its Google OAuth credentials before it can connect.",
  youtube_state_failed: "The YouTube connection could not start. Try again.",
  youtube_access_denied: "YouTube access was not granted.",
  youtube_callback_invalid: "Google returned an incomplete connection response.",
  youtube_state_invalid: "That YouTube connection request expired. Start it again.",
  youtube_connection_failed: "YouTube connected unsuccessfully. Check the server logs and OAuth settings.",
  youtube_account_missing: "Choose a connected YouTube account before syncing.",
  youtube_sync_failed: "The YouTube sync did not finish. Your existing analytics remain safe.",
  tiktok_not_configured: "TikTok needs its developer credentials before it can connect.",
  tiktok_state_failed: "The TikTok connection could not start. Try again.",
  tiktok_access_denied: "TikTok access was not granted.",
  tiktok_callback_invalid: "TikTok returned an incomplete connection response.",
  tiktok_state_invalid: "That TikTok connection request expired. Start it again.",
  tiktok_connection_failed: "TikTok did not connect. Check the server logs, app review, and OAuth settings.",
  tiktok_account_missing: "Choose a connected TikTok account before syncing.",
  tiktok_sync_failed: "The TikTok sync did not finish. Your existing analytics remain safe.",
  instagram_not_configured: "Instagram needs its Meta app credentials before it can connect.",
  instagram_state_failed: "The Instagram connection could not start. Try again.",
  instagram_access_denied: "Instagram access was not granted.",
  instagram_callback_invalid: "Instagram returned an incomplete connection response.",
  instagram_state_invalid: "That Instagram connection request expired. Start it again.",
  instagram_connection_failed: "Instagram did not connect. Check the server logs, app permissions, and redirect URL.",
  instagram_account_missing: "Choose a connected Instagram account before syncing.",
  instagram_sync_failed: "The Instagram sync did not finish. Your existing analytics remain safe.",
  facebook_not_configured: "Facebook needs its Meta app credentials before it can connect.",
  facebook_state_failed: "The Facebook connection could not start. Try again.",
  facebook_access_denied: "Facebook Page access was not granted.",
  facebook_callback_invalid: "Facebook returned an incomplete connection response.",
  facebook_state_invalid: "That Facebook connection request expired. Start it again.",
  facebook_connection_failed: "Facebook did not connect. Check the server logs, Page role, app permissions, and redirect URL.",
  facebook_sync_failed: "The Facebook sync did not finish. Your existing analytics remain safe.",
};

type ConnectionsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ConnectionsPage({ searchParams }: ConnectionsPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  if (!user) {
    return (
      <main className="app-shell">
        <Sidebar activeSection="connections" />
        <section className="main-content connections-content">
          <header className="topbar">
            <div>
              <p className="eyebrow">Data sources</p>
              <h1>Account connections.</h1>
              <p className="header-subtitle">Control which creator accounts feed this dashboard.</p>
            </div>
          </header>

          <section className="connection-auth-state" aria-labelledby="connection-auth-heading">
            <LockKeyhole size={22} aria-hidden="true" />
            <div>
              <h2 id="connection-auth-heading">Sign in before connecting accounts.</h2>
              <p>Platform authorization and analytics stay attached to your private creator profile.</p>
            </div>
            <Link className="connection-primary-action" href="/login?next=/settings/connections">
              Sign in
            </Link>
          </section>
        </section>
      </main>
    );
  }

  const { data: accounts, error } = await supabase
    .from("social_accounts")
    .select("id, platform, display_name, handle, status, last_synced_at")
    .order("platform");

  if (error) {
    throw new Error(`Unable to load social connections: ${error.message}`);
  }

  const youtubeReady = isYoutubeConnectorConfigured();
  const tiktokReady = isTikTokConnectorConfigured();
  const instagramReady = isInstagramConnectorConfigured();
  const facebookReady = isFacebookConnectorConfigured();
  const errorCode = singleValue(params.error);
  const connectedPlatform = singleValue(params.connected);
  const syncedPlatform = singleValue(params.synced);
  const syncStatus = singleValue(params.sync);
  const notice = getNotice(errorCode, connectedPlatform, syncedPlatform, syncStatus);

  return (
    <main className="app-shell">
      <Sidebar activeSection="connections" />

      <section className="main-content connections-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Data sources</p>
            <h1>Account connections.</h1>
            <p className="header-subtitle">Connect and refresh the accounts that power your analytics.</p>
          </div>

          <form action="/auth/signout" method="post">
            <button className="connection-signout" type="submit">Sign out</button>
          </form>
        </header>

        {notice && (
          <div className={`connection-notice connection-notice-${notice.tone}`} role="status">
            {notice.tone === "success"
              ? <Check size={17} aria-hidden="true" />
              : <CircleAlert size={17} aria-hidden="true" />}
            <span>{notice.message}</span>
          </div>
        )}

        <div className="connections-grid">
          {platformKeys.map((platformKey) => {
            const platform = platforms[platformKey];
            const Icon = platformIcons[platformKey];
            const platformAccounts = accounts.filter((item) => item.platform === platformKey);
            const account = platformAccounts[0];
            const connectorReady = platformKey === "youtube"
              ? youtubeReady
              : platformKey === "tiktok"
                ? tiktokReady
                : platformKey === "instagram"
                  ? instagramReady
                  : platformKey === "facebook" && facebookReady;
            const connectorPath = `/api/connect/${platformKey}`;
            const syncPath = `/api/sync/${platformKey}`;

            return (
              <article className="connection-card" key={platformKey}>
                <div className="connection-card-heading">
                  <span className="connection-platform-icon" style={{ color: platform.color }}>
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <span className={account ? "connection-status connection-status-live" : "connection-status"}>
                    {account ? account.status : "Not connected"}
                  </span>
                </div>

                <h2>{platform.label}</h2>
                <p className="connection-description">
                  {account
                    ? connectionLabel(account, platformAccounts.length)
                    : platform.description}
                </p>

                <div className="connection-card-footer">
                  <span>{account?.last_synced_at ? `Synced ${formatSyncDate(account.last_synced_at)}` : connectorReady ? "Ready to authorize" : "Connector setup pending"}</span>

                  {connectorReady && !account && (
                    <Link className="connection-primary-action" href={connectorPath}>
                      <Link2 size={16} aria-hidden="true" />
                      Connect
                    </Link>
                  )}

                  {connectorReady && account && (
                    <div className="connection-actions">
                      <form action={syncPath} method="post">
                        <input name="accountId" type="hidden" value={account.id} />
                        <button type="submit" title={`Refresh ${platform.label} analytics`}>
                          <RefreshCw size={16} aria-hidden="true" />
                          Sync
                        </button>
                      </form>
                      <Link href={connectorPath} title={`Reconnect ${platform.label}`}>
                        <Link2 size={16} aria-hidden="true" />
                        Reconnect
                      </Link>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function singleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getNotice(
  errorCode?: string,
  connectedPlatform?: string,
  syncedPlatform?: string,
  syncStatus?: string,
) {
  if (errorCode) {
    return {
      tone: "error" as const,
      message: noticeMessages[errorCode] ?? "The connection could not be completed.",
    };
  }

  if (connectedPlatform === "youtube") {
    return {
      tone: "success" as const,
      message: syncStatus === "succeeded"
        ? "YouTube is connected and its analytics are up to date."
        : "YouTube is connected. Some video-level history will retry on the next sync.",
    };
  }

  if (connectedPlatform === "tiktok") {
    return {
      tone: "success" as const,
      message: syncStatus === "succeeded"
        ? "TikTok is connected and its real-data baseline is saved. Trend changes will build with each sync."
        : "TikTok is connected, but its first analytics baseline needs another sync.",
    };
  }

  if (connectedPlatform === "instagram") {
    return {
      tone: "success" as const,
      message: syncStatus === "succeeded"
        ? "Instagram is connected and its available account and media insights are up to date."
        : "Instagram is connected. Metrics Meta did not make available will retry on the next sync.",
    };
  }

  if (connectedPlatform === "facebook") {
    return {
      tone: "success" as const,
      message: syncStatus === "succeeded"
        ? "Facebook Pages are connected and their available analytics are up to date."
        : "Facebook Pages are connected. Unavailable Page or post metrics will retry on the next sync.",
    };
  }

  if (syncedPlatform === "youtube") {
    return {
      tone: "success" as const,
      message: syncStatus === "succeeded"
        ? "YouTube analytics are up to date."
        : "YouTube account analytics updated; some video history is still pending.",
    };
  }

  if (syncedPlatform === "tiktok") {
    return {
      tone: "success" as const,
      message: "TikTok analytics are up to date. Growth is measured against the previous daily snapshot.",
    };
  }

  if (syncedPlatform === "instagram") {
    return {
      tone: "success" as const,
      message: syncStatus === "succeeded"
        ? "Instagram analytics are up to date."
        : "Instagram refreshed; some unavailable media insights will retry later.",
    };
  }

  if (syncedPlatform === "facebook") {
    return {
      tone: "success" as const,
      message: syncStatus === "succeeded"
        ? "Facebook Page analytics are up to date."
        : "Facebook Pages refreshed; unavailable metrics will retry later.",
    };
  }

  return null;
}

function connectionLabel(
  account: { display_name: string | null; handle: string | null },
  accountCount: number,
) {
  const label = account.display_name || account.handle || "Connected account";
  return accountCount > 1 ? `${label} + ${accountCount - 1} more` : label;
}

function formatSyncDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Indiana/Indianapolis",
  }).format(new Date(value));
}
