import { Schema, model, Document } from "mongoose";

export interface IVerificationLog extends Document {
  reportId: string;
  actor: string; // "system" or a user's email/id
  fromStatus: string;
  toStatus: string;
  comment?: string;
  at: Date;
}

const VerificationLogSchema = new Schema<IVerificationLog>({
  reportId: { type: String, required: true },
  actor: { type: String, required: true },
  fromStatus: { type: String, required: true },
  toStatus: { type: String, required: true },
  comment: String,
  at: { type: Date, default: Date.now },
});

VerificationLogSchema.index({ reportId: 1, at: -1 });

export const VerificationLog = model<IVerificationLog>("VerificationLog", VerificationLogSchema);
