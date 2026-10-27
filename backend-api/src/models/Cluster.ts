import { Schema, model, Document } from "mongoose";

export interface ICluster extends Document {
  clusterId: string;
  category?: string;
  centroid?: { type: "Point"; coordinates: [number, number] };
  reportCount: number;
  sourceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const ClusterSchema = new Schema<ICluster>({
  clusterId: { type: String, required: true, unique: true },
  category: String,
  centroid: {
    type: { type: String, enum: ["Point"], default: undefined },
    coordinates: { type: [Number], default: undefined },
  },
  reportCount: { type: Number, default: 0 },
  sourceCount: { type: Number, default: 0 },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
});

ClusterSchema.index({ centroid: "2dsphere" });
ClusterSchema.index({ lastSeenAt: -1 });

export const Cluster = model<ICluster>("Cluster", ClusterSchema);
