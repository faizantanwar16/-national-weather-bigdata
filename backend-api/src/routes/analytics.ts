import { Router, Request, Response } from "express";
import { Report } from "../models/Report";

const router = Router();

// GET /api/analytics/summary — counts by category and by state, verified only
router.get("/summary", async (_req: Request, res: Response) => {
  const byCategory = await Report.aggregate([
    { $match: { verificationStatus: "verified" } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
  ]);

  const byState = await Report.aggregate([
    { $match: { verificationStatus: "verified" } },
    { $group: { _id: "$state", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  res.json({ byCategory, topStates: byState });
});

// GET /api/analytics/timeseries — counts over time
router.get("/timeseries", async (req: Request, res: Response) => {
  const granularity = req.query.granularity === "hour" ? "%Y-%m-%dT%H:00:00" : "%Y-%m-%d";

  const series = await Report.aggregate([
    { $match: { verificationStatus: "verified" } },
    {
      $group: {
        _id: { $dateToString: { format: granularity, date: "$submittedAt" } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json({ series });
});

export default router;
