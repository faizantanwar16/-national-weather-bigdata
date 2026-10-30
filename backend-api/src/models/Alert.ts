import { Schema, model, Document } from "mongoose";

export type Severity = "extreme" | "severe" | "moderate" | "low";

// Official or manually published alerts. Community hotspots are computed live (see services/hotspots.ts).
export interface IAlert extends Document {
  alertId: string;
  title: string;
  severity: Severity;
  type: string;
  states: string[];
  region: string;
  issuedAt: Date;
  expiresAt: Date;
  description: string;
  source: string;
  lat: number;
  lng: number;
  createdBy?: string;
}

const AlertSchema = new Schema<IAlert>({
  alertId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  severity: { type: String, enum: ["extreme", "severe", "moderate", "low"], required: true },
  type: { type: String, required: true },
  states: { type: [String], default: [] },
  region: { type: String, required: true },
  issuedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  description: { type: String, default: "" },
  source: { type: String, default: "Official bulletin" },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  createdBy: String,
});

AlertSchema.index({ expiresAt: 1 });

export const Alert = model<IAlert>("Alert", AlertSchema);
