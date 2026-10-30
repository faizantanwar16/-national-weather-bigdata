import { Router, Request, Response } from "express";
import { z } from "zod";
import { Report } from "../models/Report";
import { parseQuery } from "../middleware/validate";
import { computeHotspots } from "../services/hotspots";
import { CATEGORIES } from "./reports";

const router = Router();

const q = z.object({
  dateFrom: z.coerce.date().optional(), dateTo: z.coerce.date().optional(),
  state: z.string().max(80).optional(), category: z.enum(CATEGORIES).optional(),
  granularity: z.enum(["hour", "day"]).default("day"),
});

function base(p: z.output<typeof q>) {
  const m: Record<string, unknown> = { verificationStatus: "verified" };
  if (p.state) m.state = p.state;
  if (p.category) m.category = p.category;
  if (p.dateFrom || p.dateTo) m.submittedAt = { ...(p.dateFrom ? { $gte: p.dateFrom } : {}), ...(p.dateTo ? { $lte: p.dateTo } : {}) };
  return m;
}

// GET /api/analytics/summary: counts by category and by state, verified only
router.get("/summary", async (req: Request, res: Response) => {
  const match = base(parseQuery(q, req.query));
  const [byCategory, topStates] = await Promise.all([
    Report.aggregate([{ $match: match }, { $group: { _id: "$category", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Report.aggregate([{ $match: match }, { $group: { _id: "$state", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
  ]);
  res.json({ byCategory, topStates });
});

// GET /api/analytics/timeseries: counts over time
router.get("/timeseries", async (req: Request, res: Response) => {
  const p = parseQuery(q, req.query);
  const format = p.granularity === "hour" ? "%Y-%m-%dT%H:00:00" : "%Y-%m-%d";
  const series = await Report.aggregate([
    { $match: base(p) },
    { $group: { _id: { $dateToString: { format, date: "$submittedAt" } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  res.json({ series });
});

// GET /api/analytics/hotspots: clusters with enough distinct sources inside the hotspot window
router.get("/hotspots", async (_req: Request, res: Response) => {
  res.json({ items: await computeHotspots() });
});

export default router;
