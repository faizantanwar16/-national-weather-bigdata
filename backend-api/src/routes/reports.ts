import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { Report } from "../models/Report";
import { validate } from "../middleware/validate";

const router = Router();

const createReportSchema = z.object({
  rawText: z.string().min(1),
  claimedCategory: z
    .enum(["rainfall", "thunderstorm", "flooding", "heatwave", "fog", "dust_storm", "strong_winds", "other"])
    .optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

// POST /api/reports — citizen submission (text only for now; direct write, Kafka comes in Phase 4)
router.post("/", validate(createReportSchema), async (req: Request, res: Response) => {
  const { rawText, claimedCategory, city, state, latitude, longitude } = req.body;

  const report = await Report.create({
    reportId: randomUUID(),
    sourceType: "citizen",
    rawText,
    claimedCategory,
    city,
    state,
    locationPrecision: latitude !== undefined && longitude !== undefined ? "exact" : city ? "city" : "unknown",
    location:
      latitude !== undefined && longitude !== undefined
        ? { type: "Point", coordinates: [longitude, latitude] }
        : undefined,
    verificationStatus: "pending",
  });

  res.status(201).json({ reportId: report.reportId, status: report.verificationStatus });
});

// GET /api/reports — list + filter
router.get("/", async (req: Request, res: Response) => {
  const { dateFrom, dateTo, category, state, city, status, page = "1", limit = "20" } = req.query;
  const filter: Record<string, unknown> = {};

  if (category) filter.category = { $in: [].concat(category as never) };
  if (state) filter.state = state;
  if (city) filter.city = city;
  if (status === "verified") filter.verificationStatus = "verified";
  if (status === "unverified") filter.verificationStatus = { $in: ["pending", "needs_review"] };
  if (dateFrom || dateTo) {
    filter.submittedAt = {
      ...(dateFrom ? { $gte: new Date(dateFrom as string) } : {}),
      ...(dateTo ? { $lte: new Date(dateTo as string) } : {}),
    };
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));

  const [items, total] = await Promise.all([
    Report.find(filter)
      .sort({ submittedAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Report.countDocuments(filter),
  ]);

  res.json({ items, page: pageNum, limit: limitNum, total });
});

// GET /api/reports/:id — public detail; rejected reports are hidden from the public
router.get("/:id", async (req: Request, res: Response) => {
  const report = await Report.findOne({ reportId: req.params.id });
  if (!report || report.verificationStatus === "rejected") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Report not found" } });
  }
  res.json(report);
});

export default router;
