// In-process version of the three pipeline stages (SRS section 8): dedup -> trust score -> classify,
// then the storage/notify step. It processes reports that are "pending". If your teammates' Kafka
// consumers take over (PIPELINE_MODE=external), this file is simply not used and the rest is unchanged.
import { randomBytes } from "crypto";
import { Report, IReport, EventCategory } from "../models/Report";
import { Cluster, ICluster } from "../models/Cluster";
import { Source, ISource } from "../models/Source";
import { VerificationLog } from "../models/VerificationLog";
import { FailedReport } from "../models/FailedReport";
import { getSetting } from "./settings";
import { geohashEncode, haversineKm } from "./geo";
import { publishReport } from "./events";
import { checkHotspot } from "./hotspots";

type Cat = Exclude<EventCategory, "other">;
const HOUR = 3600_000;
// A report without a place has an empty `location` object, so check the coordinates, not the object.
const coordsOf = (r: IReport): [number, number] | undefined => (r.location?.coordinates?.length === 2 ? (r.location.coordinates as [number, number]) : undefined);

// ---------------------------------------------------------------- classification (8.3 stage 1)
const KEYWORDS: Record<Cat, string[]> = {
  flooding: ["flood", "flooding", "flooded", "waterlogging", "water logging", "waterlogged", "overflow", "overflowing", "submerged", "knee-deep", "baadh", "jalbharav", "jal bharav"],
  rainfall: ["rain", "rains", "raining", "rainfall", "downpour", "drizzle", "baarish", "barish", "varsha"],
  thunderstorm: ["thunder", "thunderstorm", "lightning", "bijli", "toofan"],
  heatwave: ["heatwave", "heat wave", "scorching", "extreme heat", "loo", "garmi", "degrees"],
  fog: ["fog", "foggy", "mist", "low visibility", "kohra", "dhund"],
  dust_storm: ["dust storm", "duststorm", "sandstorm", "aandhi", "andhi", "dhool"],
  strong_winds: ["strong wind", "strong winds", "gale", "gusty", "tez hawa", "uprooted"],
};
const MATCHERS = (Object.entries(KEYWORDS) as [Cat, string[]][]).map(([cat, words]) => [cat, words.map((w) => new RegExp(`\\b${w.replace(/[-\s]/g, "[-\\s]")}\\b`, "i"))] as const);
const RELATED: Cat[] = ["rainfall", "flooding", "thunderstorm"]; // loosely compatible with each other

export interface Classification { category: EventCategory; confidence: number; probabilities: Record<string, number>; modelVersion: string; textHit: boolean }

export function classifyText(text: string, claimed?: EventCategory): Classification {
  const scores = MATCHERS.map(([cat, res]) => [cat, res.filter((re) => re.test(text)).length] as const);
  const max = Math.max(...scores.map((s) => s[1]));
  const total = scores.reduce((a, s) => a + s[1], 0);
  const probabilities: Record<string, number> = Object.fromEntries(scores.map(([c, n]) => [c, total ? +(n / total).toFixed(2) : 0]));
  const done = (category: EventCategory, confidence: number, textHit: boolean): Classification => ({ category, confidence, probabilities, modelVersion: "kw-1.0.0", textHit });
  if (max === 0) return claimed ? done(claimed, 0.55, false) : done("other", 0.3, false);
  const winners = scores.filter((s) => s[1] === max).map((s) => s[0]);
  if (winners.length > 1) return claimed && (winners as string[]).includes(claimed) ? done(claimed, 0.7, true) : done(winners[0], 0.4, true);
  const w = winners[0];
  if (!claimed) return done(w, 0.6, true);
  if (claimed === w) return done(w, 0.85, true);
  if (RELATED.includes(w) && (RELATED as string[]).includes(claimed)) return done(claimed, 0.7, true);
  return done(w, 0.45, true); // text clearly disagrees with what the citizen picked
}

// ---------------------------------------------------------------- text similarity (8.1)
const STOP = new Set("the and for are was with that this from have has had not but you your our over near after since very been into they them their there then than about just also when what where which while will would could should can its it's is in on at of to a an as by or be we i me my so if no".split(" "));
function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9\u0900-\u097f]+/).filter((t) => t.length > 2 && !STOP.has(t));
}
function tf(toks: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  toks.forEach((t) => (m[t] = (m[t] ?? 0) + 1));
  return m;
}
function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const k in a) { const x = 1 + Math.log(a[k]); na += x * x; if (b[k]) dot += x * (1 + Math.log(b[k])); }
  for (const k in b) { const y = 1 + Math.log(b[k]); nb += y * y; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ---------------------------------------------------------------- stage 1: dedup
export async function dedup(r: IReport, cat: EventCategory): Promise<{ cluster: ICluster; isNew: boolean }> {
  const [maxKm, windowMin, threshold] = await Promise.all([getSetting<number>("dedup.maxDistanceKm"), getSetting<number>("dedup.windowMinutes"), getSetting<number>("dedup.similarityThreshold")]);
  const t = r.submittedAt.getTime(), src = r.sourceId ?? `${r.sourceType}:anonymous`, vec = tf(tokens(r.rawText));
  const pt = coordsOf(r);
  const located = !!pt && r.locationPrecision !== "unknown";

  let best: { c: ICluster; score: number } | null = null;
  if (located) {
    const [lng, lat] = pt!;
    const span = Math.min(windowMin, 360) * 60_000; // cluster explosion guard: closed after 6 h of silence
    const candidates = await Cluster.find({
      centroid: { $geoWithin: { $centerSphere: [[lng, lat], maxKm / 6378.1] } },
      lastSeenAt: { $gte: new Date(t - span), $lte: new Date(t + span) },
    }).limit(50);
    for (const c of candidates) {
      const dominant = c.category;
      if (r.claimedCategory && dominant && dominant !== r.claimedCategory && !(RELATED.includes(dominant as Cat) && RELATED.includes(r.claimedCategory as Cat))) continue;
      const dist = haversineKm([lat, lng], [c.centroid!.coordinates[1], c.centroid!.coordinates[0]]);
      let geo = Math.max(0, 1 - dist / maxKm);
      if (r.locationPrecision !== "exact") geo = Math.min(geo, 0.5);
      const time = Math.max(0, 1 - Math.abs(t - c.lastSeenAt.getTime()) / (windowMin * 60_000));
      const score = 0.4 * geo + 0.25 * time + 0.35 * cosine(c.textProfile ?? {}, vec);
      if (!best || score > best.score) best = { c, score };
    }
  }

  if (best && best.score >= threshold) {
    const c = best.c, n = c.reportCount, [lng, lat] = pt!;
    c.centroid = { type: "Point", coordinates: [(c.centroid!.coordinates[0] * n + lng) / (n + 1), (c.centroid!.coordinates[1] * n + lat) / (n + 1)] };
    c.reportCount = n + 1;
    if (!c.sources.includes(src)) c.sources.push(src);
    c.sourceCount = c.sources.length;
    c.lastSeenAt = new Date(Math.max(c.lastSeenAt.getTime(), t));
    c.firstSeenAt = new Date(Math.min(c.firstSeenAt.getTime(), t));
    c.categoryVotes[cat] = (c.categoryVotes[cat] ?? 0) + 1;
    c.category = Object.entries(c.categoryVotes).sort((a, b) => b[1] - a[1])[0][0];
    if (c.profileCount < 10) { for (const [k, v] of Object.entries(tf(tokens(r.rawText)))) c.textProfile[k] = (c.textProfile[k] ?? 0) + v; c.profileCount += 1; }
    c.markModified("categoryVotes"); c.markModified("textProfile");
    await c.save();
    return { cluster: c, isNew: false };
  }

  const day = new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
  const gh = r.geohash ? r.geohash.slice(0, 4) : "unkn";
  const c = await Cluster.create({
    clusterId: `c-${day}-${gh}-${randomBytes(2).toString("hex")}`,
    category: cat, city: r.city, state: r.state,
    centroid: located ? { type: "Point", coordinates: pt! } : undefined,
    reportCount: 1, sourceCount: 1, sources: [src], categoryVotes: { [cat]: 1 }, textProfile: tf(tokens(r.rawText)), profileCount: 1,
    firstSeenAt: new Date(t), lastSeenAt: new Date(t),
  });
  return { cluster: c, isNew: true };
}

// ---------------------------------------------------------------- stage 2: trust (8.2)
const CORRO = [0, 0, 10, 17, 22, 25];
function supports(cat: EventCategory, o: NonNullable<IReport["observation"]>): boolean {
  if (cat === "rainfall" || cat === "flooding" || cat === "thunderstorm") return (o.precipMm ?? 0) > 0 || /rain|thunder|storm/i.test(o.alert ?? "");
  if (cat === "heatwave") return (o.tempC ?? 0) >= 40;
  if (cat === "fog") return o.visibilityM !== undefined && o.visibilityM < 1000;
  if (cat === "dust_storm" || cat === "strong_winds") return (o.windKmh ?? 0) >= 40 || /wind|dust/i.test(o.alert ?? "");
  return false;
}
function contradicts(cat: EventCategory, o: NonNullable<IReport["observation"]>): boolean {
  if (cat === "heatwave") return o.tempC !== undefined && o.tempC < 32;
  if (cat === "fog") return (o.visibilityM ?? 0) > 5000;
  if (cat === "rainfall" || cat === "flooding" || cat === "thunderstorm") return o.precipMm === 0 && (o.cloudPct ?? 100) < 30;
  return false;
}

async function officialMatch(r: IReport, cat: EventCategory): Promise<{ pts: number; reason: string }> {
  const pt = coordsOf(r);
  if (!pt) return { pts: 8, reason: "No location, so official data could not be checked" };
  const [lng, lat] = pt, t = r.submittedAt.getTime();
  const near = await Report.find({
    sourceType: "api", observation: { $exists: true }, reportId: { $ne: r.reportId },
    submittedAt: { $gte: new Date(t - 3 * HOUR), $lte: new Date(t + 3 * HOUR) },
    location: { $geoWithin: { $centerSphere: [[lng, lat], 25 / 6378.1] } },
  }).limit(10);
  if (!near.length) return { pts: 8, reason: "No official data available nearby (neutral)" };
  if (near.some((a) => supports(cat, a.observation!))) return { pts: 25, reason: "Official observation nearby supports this claim" };
  if (near.every((a) => contradicts(cat, a.observation!))) return { pts: 0, reason: "Official observation nearby contradicts this claim" };
  return { pts: 10, reason: "Official data nearby is weak or only partly matches" };
}

function textPlausibility(text: string, contradictsClaim: boolean): { pts: number; reason?: string } {
  const letters = text.replace(/[^A-Za-z]/g, ""), caps = letters.replace(/[^A-Z]/g, "");
  let pts = 10; const why: string[] = [];
  if (text.trim().length < 15) { pts -= 4; why.push("very short"); }
  if (letters.length > 8 && caps.length / letters.length > 0.6) { pts -= 3; why.push("mostly capital letters"); }
  if ((text.match(/#/g) ?? []).length >= 4 || (text.match(/https?:\/\//g) ?? []).length > 1) { pts -= 3; why.push("too many hashtags or links"); }
  if (contradictsClaim) { pts -= 5; why.push("text disagrees with the chosen event type"); }
  return { pts: Math.max(0, pts), reason: why.length ? `Text looks doubtful: ${why.join(", ")}` : undefined };
}

export async function getOrCreateSource(r: IReport): Promise<ISource> {
  const id = r.sourceId ?? `${r.sourceType}:anonymous`;
  return Source.findOneAndUpdate(
    { sourceId: id },
    { $setOnInsert: { sourceId: id, type: r.sourceType, reliability: 0.4, reportCount: 0, approvedCount: 0, rejectedCount: 0, blocked: false, allowListed: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ) as Promise<ISource>;
}

async function trust(r: IReport, cat: EventCategory, cls: Classification, cluster: ICluster, src: ISource) {
  if (src.allowListed) return { score: 95, breakdown: undefined, reasons: ["Official source on the allow-list (fixed score 95)"], forceReview: false };
  const reasons: string[] = [];
  const official = await officialMatch(r, cat);
  const hashes = r.media.map((m) => m.phash).filter(Boolean) as string[];
  let media = 0;
  if (r.media.length) {
    const reused = hashes.length ? await Report.exists({ "media.phash": { $in: hashes }, reportId: { $ne: r.reportId }, clusterId: { $ne: r.clusterId } }) : null;
    media = reused ? 0 : 6 + (hashes.length ? 3 : 0);
    reasons.push(reused ? "A photo was already used in an earlier, unrelated report" : "Photo attached; no EXIF to verify");
  } else reasons.push("No media attached");
  const mismatch = !!r.claimedCategory && cls.textHit && cls.confidence < 0.5;
  const text = textPlausibility(r.rawText, mismatch);
  const breakdown = {
    sourceReliability: src.blocked ? 0 : Math.round(25 * src.reliability),
    corroboration: CORRO[Math.min(5, cluster.sourceCount)],
    officialMatch: official.pts, media, text: text.pts,
  };
  reasons.unshift(`${cluster.sourceCount} distinct source${cluster.sourceCount === 1 ? "" : "s"} in this cluster`, official.reason);
  if (text.reason) reasons.push(text.reason);
  if (src.blocked) reasons.push("Source is blocked by an administrator");
  const score = Math.max(0, Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0)));
  return { score, breakdown, reasons, forceReview: src.blocked };
}

// When a later report adds a new source to an event, earlier members that are still waiting for review get the better
// corroboration score. If that lifts them over the threshold they are verified (never rejected, never touches moderator decisions).
async function rescoreMembers(cluster: ICluster, threshold: number) {
  const corro = CORRO[Math.min(5, cluster.sourceCount)];
  const members = await Report.find({
    clusterId: cluster.clusterId, verificationStatus: "needs_review", verifiedBy: null, lowConfidence: { $ne: true },
    trustBreakdown: { $exists: true }, "trustBreakdown.corroboration": { $lt: corro }, locationPrecision: { $ne: "unknown" },
  });
  for (const m of members) {
    if (m.trustReasons?.some((x) => x.startsWith("Source is blocked"))) continue;
    const score = Math.min(100, (m.trustScore ?? 0) + corro - (m.trustBreakdown!.corroboration as number));
    const verify = score >= threshold;
    const reasons = (m.trustReasons ?? []).map((x) => (/^\d+ distinct source/.test(x) ? `${cluster.sourceCount} distinct source${cluster.sourceCount === 1 ? "" : "s"} in this cluster` : x));
    const updated = await Report.findOneAndUpdate(
      { reportId: m.reportId, verificationStatus: "needs_review", verifiedBy: null },
      { trustScore: score, "trustBreakdown.corroboration": corro, trustReasons: reasons, ...(verify ? { verificationStatus: "verified", verifiedBy: "system" } : {}) }, { new: true });
    if (updated && verify) {
      await VerificationLog.create({ reportId: m.reportId, actor: "system", fromStatus: "needs_review", toStatus: "verified", comment: `Re-scored: more sources confirmed this event (trust ${score}, threshold ${threshold})` });
      publishReport(updated);
    }
  }
}

// ---------------------------------------------------------------- one report through all stages
export async function processReport(reportId: string): Promise<void> {
  const r = await Report.findOne({ reportId });
  if (!r || r.verificationStatus !== "pending") return;
  if (r.sourceType !== "citizen" && r.category && r.trustScore !== undefined) return;
  const [threshold, minConf] = await Promise.all([getSetting<number>("trust.autoVerifyThreshold"), getSetting<number>("classification.minConfidence")]);

  const here = coordsOf(r);
  if (!r.geohash && here) r.geohash = geohashEncode(here[1], here[0]);
  const cls = classifyText(r.rawText, r.claimedCategory);

  let cluster: ICluster | null = r.clusterId ? await Cluster.findOne({ clusterId: r.clusterId }) : null; // retry-safe (FR-DED-05)
  let isNew = r.isNewCluster ?? false;
  if (!cluster) {
    const d = await dedup(r, cls.category);
    cluster = d.cluster; isNew = d.isNew;
    await Report.updateOne({ reportId }, { clusterId: cluster.clusterId, clusterSize: cluster.reportCount, isNewCluster: isNew, geohash: r.geohash });
    r.clusterId = cluster.clusterId;
  }
  const dedupAt = new Date();

  const src = await getOrCreateSource(r);
  const t = await trust(r, cls.category, cls, cluster, src);
  const trustAt = new Date();

  const lowConfidence = cls.confidence < minConf;
  const located = !!here && r.locationPrecision !== "unknown";
  const auto = t.score >= threshold && !lowConfidence && !t.forceReview && located;
  const status = auto ? "verified" : "needs_review"; // never "rejected": only moderators reject (FR-TRU-10)
  const reasons = [...t.reasons];
  if (lowConfidence) reasons.push("Classifier is not confident about the event type");
  if (!located) reasons.push("No usable location, so a moderator must check it");
  const classifiedAt = new Date();

  const updated = await Report.findOneAndUpdate(
    { reportId, verificationStatus: "pending" },
    {
      clusterSize: cluster.reportCount, trustScore: t.score, trustBreakdown: t.breakdown, trustReasons: reasons,
      category: cls.category, categoryConfidence: +cls.confidence.toFixed(2), lowConfidence, modelVersion: cls.modelVersion,
      verificationStatus: status, verifiedBy: auto ? "system" : null, stageTimes: { dedupAt, trustAt, classifiedAt },
    },
    { new: true }
  );
  if (!updated) return;
  await VerificationLog.create({ reportId, actor: "system", fromStatus: "pending", toStatus: status, comment: `Automatic: trust ${t.score}, threshold ${threshold}` });
  await Source.updateOne({ sourceId: src.sourceId }, { $inc: { reportCount: 1 } });
  publishReport(updated);
  if (!isNew) await rescoreMembers(cluster, threshold);
  await checkHotspot(cluster.clusterId);
}

async function processWithRetry(reportId: string) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await processReport(reportId); return; } catch (e) { last = e; await new Promise((res) => setTimeout(res, 300 * 2 ** attempt)); }
  }
  console.error(`[pipeline] giving up on ${reportId}`, last);
  await FailedReport.create({ reportId, stage: "processing", error: String((last as Error)?.message ?? last) });
  await Report.updateOne({ reportId, verificationStatus: "pending" }, { verificationStatus: "needs_review", lowConfidence: true, trustReasons: ["Automatic processing failed, so a moderator must check it"] });
}

// ---------------------------------------------------------------- queue (one report at a time keeps clustering safe)
let chain: Promise<void> = Promise.resolve();
const queued = new Set<string>();
export const pipelineEnabled = () => process.env.PIPELINE_MODE !== "external";

export function enqueue(reportId: string) {
  if (!pipelineEnabled() || queued.has(reportId)) return;
  queued.add(reportId);
  chain = chain.then(() => processWithRetry(reportId)).catch(() => undefined).finally(() => { queued.delete(reportId); });
}

export async function drain(): Promise<void> { await chain; }

/** Picks up pending reports that were inserted by someone else (or left over after a crash). */
export async function sweepPending() {
  const stale = await Report.find({ verificationStatus: "pending", sourceType: "citizen", ingestedAt: { $lt: new Date(Date.now() - 5000) } }).sort({ submittedAt: 1 }).limit(200).select("reportId");
  stale.forEach((r) => enqueue(r.reportId));
}

export function startPipeline() {
  if (!pipelineEnabled()) { console.log("[pipeline] external mode: reports are processed by your Kafka consumers"); return; }
  console.log("[pipeline] in-process mode: dedup, trust and classification run inside backend-api");
  sweepPending().catch(() => undefined);
  setInterval(() => sweepPending().catch(() => undefined), 30_000).unref();
}
