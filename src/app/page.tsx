import { OverviewPage } from "@/components/dashboard/overview-page";
import { getLiveDashboard } from "@/lib/analytics/live-dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const dataset = await getLiveDashboard();

  return (
    <OverviewPage
      connected={dataset.connected}
      allTime={dataset.allTime}
      initialAnalyticsByRange={dataset.overview}
      initialPlatformAnalyticsByRange={dataset.platforms}
      contentPosts={dataset.contentPosts}
    />
  );
}
