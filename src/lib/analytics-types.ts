/** Shared traffic types (safe for client components — no Node imports). */

export type TrafficBucket = { visitors: number; views: number };

export type HourlyPoint = { bucket: string; visitors: number; views: number };

export type DailyPoint = { day: string; visitors: number; views: number };

export type PageRow = { path: string; visitors: number; views: number };

export type SourceRow = { source: string; visitors: number; views: number };

export type CountryRow = { country: string; visitors: number };

export type DeviceRow = { device: string; visitors: number };

export type RecentVisit = { path: string; country: string; device: string; created_at: string };

export type AnalyticsSummary = {
  live: TrafficBucket;
  last24h: TrafficBucket;
  today: TrafficBucket;
  yesterday: TrafficBucket;
  week: TrafficBucket;
  month: TrafficBucket;
  hourly: HourlyPoint[];
  daily: DailyPoint[];
  pages: PageRow[];
  referrers: SourceRow[];
  countries: CountryRow[];
  devices: DeviceRow[];
  recent: RecentVisit[];
  generated_at: string;
};
