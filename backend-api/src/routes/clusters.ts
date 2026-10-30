import { Router, Request, Response } from "express";
import { z } from "zod";
import { Cluster } from "../models/Cluster";
import { Report } from "../models/Report";
import { ApiError } from "../middleware/errorHandler";
import { parseQuery } from "../middleware/validate";

const router = Router();

const q = z.object({ minSources: z.coerce.number().int().min(1).default(1), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50) });

// GET /api/clusters: event clusters, biggest first
router.get("/", async (req: Request, res: Response) => {
  const { minSources, page, limit } = parseQuery(q, req.query);
  const filter = { sourceCount: { $gte: minSources } };
  const [items, total] = await Promise.all([
    Cluster.find(filter).sort({ lastSeenAt: -1 }).skip((page - 1) * limit).limit(limit).select("-textProfile -categoryVotes -__v"),
    Cluster.countDocuments(filter),
  ]);
  res.json({ items, page, limit, total });
});

// GET /api/clusters/:id: one cluster with its (non-rejected) member reports
router.get("/:id", async (req: Request, res: Response) => {
  const cluster = await Cluster.findOne({ clusterId: req.params.id }).select("-textProfile -categoryVotes -__v");
  if (!cluster) throw new ApiError(404, "NOT_FOUND", "Cluster not found");
  const reports = await Report.find({ clusterId: cluster.clusterId, verificationStatus: { $ne: "rejected" } }).sort({ submittedAt: -1 }).limit(100).select("-__v");
  res.json({ cluster, reports });
});

export default router;
