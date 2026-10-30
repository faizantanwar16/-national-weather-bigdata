import { Schema, model, Document } from "mongoose";

export interface ICluster extends Document {
  clusterId: string;
  category?: string;
  city?: string;
  state?: string;
  centroid?: { type: "Point"; coordinates: [number, number] };
  reportCount: number;
  sourceCount: number;
  sources: string[]; // distinct sourceIds seen in this cluster
  categoryVotes: Record<string, number>;
  textProfile: Record<string, number>; // combined term counts of the first 10 report texts
  profileCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  alertedAt?: Date; // set once a hotspot alert was raised for this cluster
}

const ClusterSchema = new Schema<ICluster>({
  clusterId: { type: String, required: true, unique: true },
  category: String,
  city: String,
  state: String,
  centroid: {
    type: { type: String, enum: ["Point"], default: undefined },
    coordinates: { type: [Number], default: undefined },
  },
  reportCount: { type: Number, default: 0 },
  sourceCount: { type: Number, default: 0 },
  sources: { type: [String], default: [] },
  categoryVotes: { type: Schema.Types.Mixed, default: {} },
  textProfile: { type: Schema.Types.Mixed, default: {} },
  profileCount: { type: Number, default: 0 },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  alertedAt: Date,
}, { minimize: false });

ClusterSchema.index({ centroid: "2dsphere" });
ClusterSchema.index({ lastSeenAt: -1 });

export const Cluster = model<ICluster>("Cluster", ClusterSchema);
