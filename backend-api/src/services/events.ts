import { EventEmitter } from "events";
import type { IReport } from "../models/Report";

// In-process event hub behind GET /api/stream (SSE). The storage step publishes here (SRS FR-STO-07).
export const hub = new EventEmitter();
hub.setMaxListeners(0);

export function publishReport(r: Pick<IReport, "reportId" | "rawText" | "category" | "claimedCategory" | "verificationStatus" | "trustScore" | "location" | "city" | "state" | "sourceId" | "sourceType" | "submittedAt" | "media" | "clusterId">) {
  hub.emit("report", {
    reportId: r.reportId, rawText: r.rawText, category: r.category, claimedCategory: r.claimedCategory, verificationStatus: r.verificationStatus,
    trustScore: r.trustScore, location: r.location, city: r.city, state: r.state, sourceId: r.sourceId, sourceType: r.sourceType,
    submittedAt: r.submittedAt, media: r.media ?? [], clusterId: r.clusterId,
  });
}

export function publishAlert(a: { alertId: string; category?: string; state?: string; sourceCount?: number; title?: string }) {
  hub.emit("alert", a);
}
