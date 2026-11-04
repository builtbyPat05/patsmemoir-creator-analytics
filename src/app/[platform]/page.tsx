import { notFound } from "next/navigation";
import { AnalyticsPage } from "@/components/dashboard/analytics-page";
import { TikTokAllTime } from "@/components/dashboard/tiktok-all-time";
import { YoutubeHistory } from "@/components/dashboard/youtube-history";
import { getLiveDashboard } from "@/lib/analytics/live-dashboard";
import { isPlatformKey, platformKeys } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";
export const dynamicParams = false;

export function generateStaticParams() {
  return platformKeys.map((platform) => ({ platform }));
}

export default async function PlatformPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;

  if (!isPlatformKey(platform)) {
    notFound();
  }

  const dataset = await getLiveDashboard();
  const analytics = dataset.platforms[platform];
  const dataSource = platform === "instagram" || !dataset.connected[platform] ? "empty" : "windsor";

  return (
    <AnalyticsPage
      dataSource={dataSource}
      allTime={dataset.allTime[platform]}
      initialAnalyticsByRange={analytics}
      contentPosts={dataset.contentPosts[platform]}
      platform={platform}
      allTimeSection={platform === "tiktok" && dataSource === "windsor" ? (
        <TikTokAllTime summary={dataset.tiktokLifetime} />
      ) : platform === "youtube" && dataSource === "windsor" ? (
        <YoutubeHistory analyticsByRange={analytics} />
      ) : undefined}
    />
  );
}
