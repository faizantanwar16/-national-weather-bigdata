import { Schema, model, Document } from "mongoose";

export type SourceType = "citizen" | "social" | "api" | "news";
export type EventCategory =
  | "rainfall" | "thunderstorm" | "flooding" | "heatwave"
  | "fog" | "dust_storm" | "strong_winds" | "other";
export type LocationPrecision = "exact" | "city" | "state" | "unknown";
export type VerificationStatus = "pending" | "needs_review" | "verified" | "rejected";
export type VerifiedBy = "system" | "moderator" | null;

// Media is left in the schema (empty for now) so the model doesn't need to change
// when the image/video phase starts. Nothing currently writes to it.
export interface IMediaItem {
  url: string;
  type: "image" | "video";
  exifTime?: Date;
  exifLat?: number;
  exifLng?: number;
  phash?: string;
}

export interface IReport extends Document {
  reportId: string;
  sourceType: SourceType;
  sourceId?: string;
  sourceRef?: string;
  rawText: string;
  language?: string;
  hashtags: string[];
  submittedAt: Date;
  ingestedAt: Date;
  location?: { type: "Point"; coordinates: [number, number] };
  locationPrecision: LocationPrecision;
  city?: string;
  state?: string;
  district?: string;
  geohash?: string;
  media: IMediaItem[];
  claimedCategory?: EventCategory;
  clusterId?: string;
  clusterSize?: number;
  isNewCluster?: boolean;
  trustScore?: number;
  trustBreakdown?: Record<string, number>;
  trustReasons?: string[];
  category?: EventCategory;
  categoryConfidence?: number;
  lowConfidence?: boolean;
  modelVersion?: string;
  verificationStatus: VerificationStatus;
  verifiedBy?: VerifiedBy;
  stageTimes?: Record<string, Date>;
  // Official observation attached to sourceType "api" reports (used by the official-data-match signal)
  observation?: { precipMm?: number; tempC?: number; visibilityM?: number; windKmh?: number; cloudPct?: number; alert?: string };
}

const MediaItemSchema = new Schema<IMediaItem>(
  {
    url: String,
    type: { type: String, enum: ["image", "video"] },
    exifTime: Date,
    exifLat: Number,
    exifLng: Number,
    phash: String,
  },
  { _id: false }
);

const ReportSchema = new Schema<IReport>({
  reportId: { type: String, required: true, unique: true },
  sourceType: { type: String, enum: ["citizen", "social", "api", "news"], required: true },
  sourceId: String,
  sourceRef: String,
  rawText: { type: String, required: true },
  language: { type: String, default: "en" },
  hashtags: { type: [String], default: [] },
  submittedAt: { type: Date, required: true, default: Date.now },
  ingestedAt: { type: Date, required: true, default: Date.now },
  location: {
    type: { type: String, enum: ["Point"], default: undefined },
    coordinates: { type: [Number], default: undefined },
  },
  locationPrecision: { type: String, enum: ["exact", "city", "state", "unknown"], default: "unknown" },
  city: String,
  state: String,
  district: String,
  geohash: String,
  media: { type: [MediaItemSchema], default: [] },
  claimedCategory: {
    type: String,
    enum: ["rainfall", "thunderstorm", "flooding", "heatwave", "fog", "dust_storm", "strong_winds", "other"],
  },
  clusterId: String,
  clusterSize: Number,
  isNewCluster: Boolean,
  trustScore: { type: Number, min: 0, max: 100 },
  trustBreakdown: { type: Schema.Types.Mixed },
  trustReasons: { type: [String], default: [] },
  category: {
    type: String,
    enum: ["rainfall", "thunderstorm", "flooding", "heatwave", "fog", "dust_storm", "strong_winds", "other"],
  },
  categoryConfidence: Number,
  lowConfidence: Boolean,
  modelVersion: String,
  verificationStatus: {
    type: String,
    enum: ["pending", "needs_review", "verified", "rejected"],
    default: "pending",
  },
  verifiedBy: { type: String, enum: ["system", "moderator", null], default: null },
  stageTimes: { type: Schema.Types.Mixed },
  observation: { type: Schema.Types.Mixed },
});

ReportSchema.index({ location: "2dsphere" });
ReportSchema.index({ submittedAt: -1 });
ReportSchema.index({ category: 1, verificationStatus: 1, submittedAt: -1 });
ReportSchema.index({ state: 1, submittedAt: -1 });
ReportSchema.index({ clusterId: 1 });
ReportSchema.index({ sourceId: 1 });
ReportSchema.index({ verificationStatus: 1, ingestedAt: 1 });
ReportSchema.index({ sourceType: 1, submittedAt: -1 });

export const Report = model<IReport>("Report", ReportSchema);
