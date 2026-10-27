import { Schema, model, Document } from "mongoose";

export interface ISource extends Document {
  sourceId: string;
  type: "citizen" | "social" | "api" | "news";
  reliability: number;
  reportCount: number;
  approvedCount: number;
  rejectedCount: number;
  blocked: boolean;
  allowListed: boolean;
}

const SourceSchema = new Schema<ISource>({
  sourceId: { type: String, required: true, unique: true },
  type: { type: String, enum: ["citizen", "social", "api", "news"], required: true },
  reliability: { type: Number, default: 0.4, min: 0, max: 1 },
  reportCount: { type: Number, default: 0 },
  approvedCount: { type: Number, default: 0 },
  rejectedCount: { type: Number, default: 0 },
  blocked: { type: Boolean, default: false },
  allowListed: { type: Boolean, default: false },
});

export const Source = model<ISource>("Source", SourceSchema);
