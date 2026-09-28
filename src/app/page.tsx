import { OverviewPage } from "@/components/dashboard/overview-page";
import { getDashboardDataset } from "@/lib/analytics/repository";

export const dynamic = "force-dynamic";

export default async function Home() {
  const dataset = await getDashboardDataset();

  return (
    <OverviewPage
      dataSource={dataset.source}
      initialAnalyticsByRange={dataset.overview}
      initialPlatformAnalyticsByRange={dataset.platforms}
    />
  );
}
