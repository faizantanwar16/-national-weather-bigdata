import { Router, Request, Response } from "express";
import { Report } from "../models/Report";
import { buildPublicFilter, parsePublicQuery } from "./reports";

const router = Router();
// Spreadsheet programs run text that starts with = + - @ as a formula, so those cells get a leading quote.
const cell = (v: unknown) => { const s = v === undefined || v === null ? "" : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return `"${safe.replace(/"/g, '""')}"`; };

// GET /api/export: CSV of the current public filter (verified reports only)
router.get("/", async (req: Request, res: Response) => {
  const q = parsePublicQuery({ ...req.query, status: "verified", limit: 500 });
  const rows = await Report.find(buildPublicFilter(q)).sort({ submittedAt: -1 }).limit(5000).lean();
  const head = ["reportId", "submittedAt", "category", "trustScore", "city", "state", "latitude", "longitude", "text"];
  const lines = rows.map((r) => [r.reportId, r.submittedAt.toISOString(), r.category, r.trustScore, r.city, r.state, r.location?.coordinates[1], r.location?.coordinates[0], r.rawText].map(cell).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="nwa-verified-reports.csv"');
  res.send([head.join(","), ...lines].join("\n"));
});

export default router;
