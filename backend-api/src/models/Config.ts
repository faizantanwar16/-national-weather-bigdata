import { Schema, model, Document } from "mongoose";

export interface IConfig extends Document {
  key: string;
  value: unknown;
  updatedBy?: string;
  updatedAt: Date;
}

const ConfigSchema = new Schema<IConfig>({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true },
  updatedBy: String,
  updatedAt: { type: Date, default: Date.now },
});

export const Config = model<IConfig>("Config", ConfigSchema);
