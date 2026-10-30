import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { Report, EventCategory } from "../models/Report";
import { Source } from "../models/Source";
import { VerificationLog } from "../models/VerificationLog";
import { validate, parseQuery } from "../middleware/validate";
import { submitLimiter } from "../middleware/rateLimit";
import { nearestCity, resolvePlace } from "../services/gazetteer";
import { geohashEncode } from "../services/geo";
import { enqueue, dedup } from "../services/pipeline";
import { publishReport } from "../services/events";
import { checkHotspot } from "../services/hotspots";

const router = Router();
export const CATEGORIES = ["rainfall", "thunderstorm", "flooding", "heatwave", "fog", "dust_storm", "strong_winds", "other"] as const;
export const MEDIA_URL = /^https?:\/\/[^\s/]+\/uploads\/[a-f0-9]{16}-[a-f0-9]{8}\.(jpg|png|webp|mp4)$/;

const createReportSchema = z.object({
  rawText: z.string().trim().min(1).max(2000),
  claimedCategory: z.enum(CATEGORIES).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  media: z.array(z.object({ url: z.string().regex(MEDIA_URL, "must be a URL returned by /api/media"), type: z.enum(["image", "video"]) })).max(3).optional(),
});

// POST /api/reports: citizen submission. Saved as "pending", then processed by the pipeline.
router.post("/", submitLimiter, validate(createReportSchema), async (req: Request, res: Response) => {
  const { rawText, claimedCategory, city, state, latitude, longitude, media } = req.body;
  const reportId = randomUUID();
  let lat: number | undefined = latitude, lng: number | undefined = longitude;
  let precision: "exact" | "city" | "state" | "unknown" = "unknown", cityName: string | undefined = city, stateName: string | undefined = state;

  if (lat !== undefined && lng !== undefined) {
    precision = "exact";
    if (!cityName) { const n = nearestCity(lat, lng); cityName = n.city; stateName = stateName ?? n.state; }
  } else {
    const p = resolvePlace(city, state);
    if (p) {
      // spread reports from the same city a little so markers do not sit exactly on top of each other
      const h = parseInt(reportId.slice(0, 8), 16), h2 = parseInt(reportId.slice(9, 13), 16);
      const jitter = p.precision === "city" ? 0.05 : 0.4;
      lat = p.lat + ((h % 1000) / 1000 - 0.5) * jitter; lng = p.lng + ((h2 % 1000) / 1000 - 0.5) * jitter;
      precision = p.precision; cityName = p.city ?? city; stateName = p.state ?? state;
    }
  }

  const now = new Date();
  const report = await Report.create({
    reportId, sourceType: "citizen", sourceId: "citizen:anonymous", rawText,
    language: /[\u0900-\u097f]/.test(rawText) ? "hi" : "en", hashtags: rawText.match(/#\w+/g) ?? [],
    submittedAt: now, ingestedAt: now, claimedCategory, city: cityName, state: stateName, locationPrecision: precision,
    location: lat !== undefined && lng !== undefined ? { type: "Point", coordinates: [lng, lat] } : undefined,
    geohash: lat !== undefined && lng !== undefined ? geohashEncode(lat, lng) : undefined,
    media: (media ?? []).map((m: { url: string; type: "image" | "video" }) => ({ url: m.url, type: m.type, phash: m.url.split("/").pop()!.split("-")[0] })),
    verificationStatus: "pending",
  });

  enqueue(report.reportId);
  res.status(201).json({ reportId: report.reportId, status: report.verificationStatus });
});

// POST /api/reports/ingest: ingest pre-enriched social & API reports from Python ML / Spark
router.post("/ingest", async (req: Request, res: Response) => {
  const ingestKey = req.headers["x-ingest-key"] || (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, "") : "");
  const expectedKey = process.env.INGEST_KEY || "national-weather-shared-ingest-key-2026";
  if (ingestKey !== expectedKey) {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid or missing ingest key" } });
  }

  const rawReports = Array.isArray(req.body)
    ? req.body
    : Array.isArray(req.body?.reports)
    ? req.body.reports
    : [req.body];

  let inserted = 0;
  let skipped = 0;
  const sampleIds: string[] = [];

  for (const item of rawReports) {
    if (!item || typeof item !== "object") continue;
    const reportId = String(item.reportId || item.post_id || item.uri || item.url || randomUUID()).trim();
    if (!reportId) continue;

    // Insert-or-ignore: never overwrite existing reports or moderator decisions (FR-TRU-10 / Step 8)
    const existing = await Report.findOne({ reportId });
    if (existing) {
      skipped++;
      continue;
    }

    const now = new Date();
    const submittedAt = item.submittedAt ? new Date(item.submittedAt) : now;
    const ingestedAt = item.ingestedAt ? new Date(item.ingestedAt) : now;

    let location = item.location;
    let geohash = item.geohash;
    const precision = item.locationPrecision || (location ? "city" : "unknown");
    if (!location && item.lat !== undefined && item.lon !== undefined && item.lat !== null && item.lon !== null) {
      const lat = Number(item.lat), lon = Number(item.lon);
      if (!isNaN(lat) && !isNaN(lon)) {
        location = { type: "Point", coordinates: [lon, lat] };
        geohash = geohash || geohashEncode(lat, lon);
      }
    }

    const rawText = String(item.rawText || item.text || "").trim();
    if (!rawText) {
      skipped++;
      continue;
    }

    const category = (CATEGORIES.includes(item.category) ? item.category : "other") as EventCategory;
    const status = item.verificationStatus === "pending" ? "needs_review" : (item.verificationStatus || "needs_review");

    const report = new Report({
      reportId,
      sourceType: item.sourceType || "social",
      sourceId: item.sourceId || `${item.sourceType || "social"}:external`,
      sourceRef: item.sourceRef || item.uri || item.url,
      rawText,
      language: item.language || "en",
      hashtags: Array.isArray(item.hashtags) ? item.hashtags : [],
      submittedAt,
      ingestedAt,
      location,
      locationPrecision: precision,
      city: item.city,
      state: item.state,
      district: item.district,
      geohash,
      media: Array.isArray(item.media) ? item.media : [],
      claimedCategory: item.claimedCategory,
      category,
      categoryConfidence: item.categoryConfidence !== undefined ? Number(item.categoryConfidence) : 0.5,
      lowConfidence: Boolean(item.lowConfidence),
      modelVersion: item.modelVersion || "py-tfidf-1.0.0",
      trustScore: item.trustScore !== undefined ? Number(item.trustScore) : 40,
      trustBreakdown: item.trustBreakdown,
      trustReasons: Array.isArray(item.trustReasons) ? item.trustReasons : [],
      verificationStatus: status,
      verifiedBy: item.verifiedBy || null,
      observation: item.observation,
    });

    // Group into clusters if coordinates exist
    if (report.location?.coordinates?.length === 2 && report.locationPrecision !== "unknown") {
      try {
        const d = await dedup(report, report.category as EventCategory);
        report.clusterId = d.cluster.clusterId;
        report.clusterSize = d.cluster.reportCount;
        report.isNewCluster = d.isNew;
        checkHotspot(d.cluster.clusterId).catch(() => undefined);
      } catch (err) {
        console.warn(`[ingest] dedup error for ${reportId}:`, (err as Error).message);
      }
    }

    await report.save();
    inserted++;
    if (sampleIds.length < 5) sampleIds.push(report.reportId);

    // Track source
    await Source.updateOne(
      { sourceId: report.sourceId },
      {
        $setOnInsert: {
          sourceId: report.sourceId,
          type: report.sourceType,
          reliability: report.sourceType === "api" ? 0.95 : 0.4,
          allowListed: report.sourceType === "api",
          blocked: false,
          approvedCount: 0,
          rejectedCount: 0,
        },
        $inc: { reportCount: 1 },
      },
      { upsert: true }
    );

    // Verification audit log
    await VerificationLog.create({
      reportId: report.reportId,
      actor: "python-ml",
      fromStatus: "raw",
      toStatus: report.verificationStatus,
      comment: `Ingested from ${report.sourceType}: trust ${report.trustScore}`,
    });

    // Real-time SSE push
    publishReport(report);
  }

  res.status(201).json({ success: true, inserted, skipped, total: rawReports.length, sampleIds });
});

const listQuery = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  category: z.union([z.enum(CATEGORIES), z.array(z.enum(CATEGORIES))]).optional(),
  state: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  status: z.enum(["verified", "unverified"]).optional(),
  clusterId: z.string().max(80).optional(),
  bbox: z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(0.1).max(2000).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.enum(["-submittedAt", "submittedAt", "-trustScore", "trustScore"]).default("-submittedAt"),
});

/** Builds the public filter. Rejected reports are never included (SRS 7.1). */
export function buildPublicFilter(q: z.output<typeof listQuery>): Record<string, unknown> {
  const and: Record<string, unknown>[] = [{ verificationStatus: { $ne: "rejected" } }];
  if (q.status === "verified") and.push({ verificationStatus: "verified" });
  if (q.status === "unverified") and.push({ verificationStatus: { $in: ["pending", "needs_review"] } });
  if (q.category) and.push({ category: { $in: Array.isArray(q.category) ? q.category : [q.category] } });
  if (q.state) and.push({ state: q.state });
  if (q.city) and.push({ city: q.city });
  if (q.clusterId) and.push({ clusterId: q.clusterId });
  if (q.dateFrom || q.dateTo) and.push({ submittedAt: { ...(q.dateFrom ? { $gte: q.dateFrom } : {}), ...(q.dateTo ? { $lte: q.dateTo } : {}) } });
  if (q.bbox) { const [a, b, c, d] = q.bbox.split(",").map(Number); and.push({ location: { $geoWithin: { $box: [[a, b], [c, d]] } } }); }
  if (q.lat !== undefined && q.lng !== undefined && q.radiusKm !== undefined) and.push({ location: { $geoWithin: { $centerSphere: [[q.lng, q.lat], q.radiusKm / 6378.1] } } });
  return { $and: and };
}
export const parsePublicQuery = (query: unknown): z.output<typeof listQuery> => parseQuery(listQuery, query);

// GET /api/reports: list + filter + paginate
router.get("/", async (req: Request, res: Response) => {
  const q = parsePublicQuery(req.query);
  const filter = buildPublicFilter(q);
  const sortField = q.sort.replace("-", ""), dir = q.sort.startsWith("-") ? -1 : 1;
  const [items, total] = await Promise.all([
    Report.find(filter).sort({ [sortField]: dir, _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).select("-__v"),
    Report.countDocuments(filter),
  ]);
  res.json({ items, page: q.page, limit: q.limit, total });
});

// GET /api/reports/:id: public detail; rejected reports are hidden
router.get("/:id", async (req: Request, res: Response) => {
  const report = await Report.findOne({ reportId: req.params.id }).select("-__v");
  if (!report || report.verificationStatus === "rejected") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Report not found" } });
  }
  res.json(report);
});

export default router;
