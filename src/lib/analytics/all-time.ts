export type AllTimeStats = {
  views: number | null;
  followers: number | null;
  videos: number | null;
  likes: number | null;
};

export type AllTimeDashboard = {
  youtube: AllTimeStats | null;
  tiktok: AllTimeStats | null;
  instagram: null;
  overview: AllTimeStats | null;
};

export function sumAvailable(values: Array<number | null | undefined>): number | null {
  if (values.length === 0 || values.some((value) => value === null || value === undefined)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}
