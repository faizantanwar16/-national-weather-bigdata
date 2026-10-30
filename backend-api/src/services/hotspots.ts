import { Report } from "../models/Report";
import { Cluster } from "../models/Cluster";
import { getSetting } from "./settings";
import { publishAlert } from "./events";

export interface Hotspot { clusterId: string; category?: string; city?: string; state?: string; lat: number; lng: number; sources: number; reports: number; firstAt: Date; lastAt: Date }

const LABEL: Record<string, string> = { rainfall: "rainfall", thunderstorm: "thunderstorm", flooding: "flooding", heatwave: "heatwave", fog: "fog", dust_storm: "dust storm", strong_winds: "strong winds", other: "weather event" };

async function query(extra: Record<string, unknown> = {}): Promise<Hotspot[]> {
  const [windowMin, minSources] = await Promise.all([getSetting<number>("hotspot.windowMinutes"), getSetting<number>("hotspot.minSources")]);
  const since = new Date(Date.now() - windowMin * 60_000);
  const rows = await Report.aggregate([
    { $match: { clusterId: { $exists: true }, location: { $exists: true }, verificationStatus: { $ne: "rejected" }, submittedAt: { $gte: since }, ...extra } },
    { $group: {
      _id: "$clusterId", sources: { $addToSet: "$sourceId" }, reports: { $sum: 1 },
      lat: { $avg: { $arrayElemAt: ["$location.coordinates", 1] } }, lng: { $avg: { $arrayElemAt: ["$location.coordinates", 0] } },
      category: { $first: "$category" }, city: { $first: "$city" }, state: { $first: "$state" }, firstAt: { $min: "$submittedAt" }, lastAt: { $max: "$submittedAt" },
    } },
    { $addFields: { n: { $size: "$sources" } } },
    { $match: { n: { $gte: minSources } } },
    { $sort: { n: -1 } },
  ]);
  return rows.map((x) => ({ clusterId: x._id, category: x.category, city: x.city, state: x.state, lat: x.lat, lng: x.lng, sources: x.n, reports: x.reports, firstAt: x.firstAt, lastAt: x.lastAt }));
}

/** Hotspot = enough distinct sources reporting the same event within the window (SRS FR-SPK-03). */
export const computeHotspots = () => query();

export async function hotspotAlert(h: Hotspot) {
  const minSources = await getSetting<number>("hotspot.minSources");
  const windowMin = await getSetting<number>("hotspot.windowMinutes");
  return {
    id: `h-${h.clusterId}`, title: `Community hotspot: ${LABEL[h.category ?? "other"]} near ${h.city ?? "this area"}`,
    severity: h.sources >= minSources + 3 ? "severe" : "moderate", type: LABEL[h.category ?? "other"][0].toUpperCase() + LABEL[h.category ?? "other"].slice(1),
    states: h.state ? [h.state] : [], region: [h.city, h.state].filter(Boolean).join(", "), issuedAt: h.firstAt.toISOString(),
    expiresAt: new Date(h.lastAt.getTime() + windowMin * 60_000).toISOString(),
    description: `${h.sources} distinct sources and ${h.reports} reports describe the same event within a few kilometres. Detected automatically.`,
    source: "Community hotspot", lat: h.lat, lng: h.lng,
  };
}

/** Called after each processed report. Raises one live alert the first time a cluster crosses the threshold. */
export async function checkHotspot(clusterId: string) {
  const [h] = await query({ clusterId });
  if (!h) return;
  const claimed = await Cluster.findOneAndUpdate({ clusterId, alertedAt: { $exists: false } }, { alertedAt: new Date() });
  if (!claimed) return;
  const a = await hotspotAlert(h);
  publishAlert({ alertId: a.id, category: h.category, state: h.state, sourceCount: h.sources, title: a.title });
}
