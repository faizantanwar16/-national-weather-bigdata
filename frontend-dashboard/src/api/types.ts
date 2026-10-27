export type EventCategory =
  | "rainfall" | "thunderstorm" | "flooding" | "heatwave"
  | "fog" | "dust_storm" | "strong_winds" | "other";

export type SourceType = "citizen" | "social" | "api" | "news";
export type LocationPrecision = "exact" | "city" | "state" | "unknown";
export type VerificationStatus = "pending" | "needs_review" | "verified" | "rejected";
export type VerifiedBy = "system" | "moderator" | null;
export type UserRole = "moderator" | "admin";

export interface Report {
  reportId: string;
  sourceType: SourceType;
  rawText: string;
  claimedCategory?: EventCategory;
  city?: string;
  state?: string;
  location?: { type: "Point"; coordinates: [number, number] }; // [lng, lat]
  locationPrecision: LocationPrecision;
  media: unknown[];
  clusterId?: string;
  clusterSize?: number;
  trustScore?: number;
  trustBreakdown?: Record<string, number>;
  trustReasons?: string[];
  category?: EventCategory;
  categoryConfidence?: number;
  verificationStatus: VerificationStatus;
  verifiedBy: VerifiedBy;
  submittedAt: string;
  ingestedAt: string;
}

export interface ReportsResponse {
  items: Report[];
  page: number;
  limit: number;
  total: number;
}

export interface SummaryResponse {
  byCategory: { _id: EventCategory | null; count: number }[];
  topStates: { _id: string | null; count: number }[];
}

export interface TimeseriesResponse {
  series: { _id: string; count: number }[];
}

export interface AuditLogEntry {
  reportId: string;
  actor: string;
  fromStatus: string;
  toStatus: string;
  comment?: string;
  at: string;
}

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface ConfigEntry {
  key: string;
  value: unknown;
  updatedBy?: string;
  updatedAt: string;
}

export const EVENT_CATEGORIES: EventCategory[] = [
  "rainfall", "thunderstorm", "flooding", "heatwave",
  "fog", "dust_storm", "strong_winds", "other",
];

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  rainfall: "Rainfall",
  thunderstorm: "Thunderstorm",
  flooding: "Flooding",
  heatwave: "Heatwave",
  fog: "Fog",
  dust_storm: "Dust Storm",
  strong_winds: "Strong Winds",
  other: "Other",
};

export const CATEGORY_COLORS: Record<EventCategory, string> = {
  rainfall: "#0891b2",
  thunderstorm: "#7c3aed",
  flooding: "#2563eb",
  heatwave: "#dc2626",
  fog: "#6b7280",
  dust_storm: "#a16207",
  strong_winds: "#059669",
  other: "#374151",
};
