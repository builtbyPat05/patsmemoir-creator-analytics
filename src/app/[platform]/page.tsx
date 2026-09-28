import { notFound } from "next/navigation";
import { AnalyticsPage } from "@/components/dashboard/analytics-page";
import { getDashboardDataset } from "@/lib/analytics/repository";
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

  const dataset = await getDashboardDataset();

  return (
    <AnalyticsPage
      dataSource={dataset.source}
      initialAnalyticsByRange={dataset.platforms[platform]}
      platform={platform}
    />
  );
}
