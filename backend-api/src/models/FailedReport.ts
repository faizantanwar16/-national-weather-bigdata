import { Schema, model, Document } from "mongoose";

// Dead-letter record: a report the pipeline could not process (SRS 4.4, failed-reports topic).
export interface IFailedReport extends Document {
  reportId: string;
  stage: string;
  error: string;
  at: Date;
}

const FailedReportSchema = new Schema<IFailedReport>({
  reportId: { type: String, required: true },
  stage: { type: String, required: true },
  error: { type: String, required: true },
  at: { type: Date, default: Date.now },
});

FailedReportSchema.index({ at: -1 });

export const FailedReport = model<IFailedReport>("FailedReport", FailedReportSchema);
