import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { z } from "zod";
import { Report } from "../models/Report";
import { User } from "../models/User";
import { Config } from "../models/Config";
import { Source, ISource } from "../models/Source";
import { Cluster } from "../models/Cluster";
import { Alert } from "../models/Alert";
import { FailedReport } from "../models/FailedReport";
import { VerificationLog } from "../models/VerificationLog";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { validate, parseQuery } from "../middleware/validate";
import { ApiError } from "../middleware/errorHandler";
import { invalidateSettings, validateSetting } from "../services/settings";
import { publishReport } from "../services/events";
import { CATEGORIES } from "./reports";

const router = Router();
router.use(requireAuth, requireRole("moderator", "admin"));

const sourceRow = (s: ISource) => ({ id: s.sourceId, type: s.type, reliability: s.reliability, reportCount: s.reportCount, approved: s.approvedCount, rejected: s.rejectedCount, blocked: s.blocked, allowListed: s.allowListed });

// GET /api/admin/queue: reports needing review, lowest trust first
router.get("/queue", async (req: Request, res: Response) => {
  const { category, state } = parseQuery(z.object({ category: z.enum(CATEGORIES).optional(), state: z.string().max(80).optional() }), req.query);
  const filter: Record<string, unknown> = { verificationStatus: "needs_review" };
  if (category) filter.category = category;
  if (state) filter.state = state;
  const items = await Report.find(filter).sort({ trustScore: 1, submittedAt: -1 }).limit(100).select("-__v");
  res.json({ items });
});

// GET /api/admin/reports/:id: full detail for the review screen (report, cluster members, source)
router.get("/reports/:id", async (req: Request, res: Response) => {
  const report = await Report.findOne({ reportId: req.params.id }).select("-__v");
  if (!report) throw new ApiError(404, "NOT_FOUND", "Report not found");
  const [cluster, source] = await Promise.all([
    report.clusterId ? Report.find({ clusterId: report.clusterId, reportId: { $ne: report.reportId } }).sort({ submittedAt: -1 }).limit(20).select("-__v") : [],
    Source.findOne({ sourceId: report.sourceId ?? `${report.sourceType}:anonymous` }),
  ]);
  res.json({ report, cluster, source: source ? sourceRow(source) : null });
});

const verifySchema = z.object({ action: z.enum(["approve", "reject"]), comment: z.string().trim().max(500).optional(), categoryOverride: z.enum(CATEGORIES).optional() });

// PATCH /api/admin/reports/:id/verify
router.patch("/reports/:id/verify", validate(verifySchema), async (req: AuthedRequest, res: Response) => {
  const { action, comment, categoryOverride } = req.body;
  if (action === "reject" && !comment) throw new ApiError(400, "COMMENT_REQUIRED", "A comment is required when rejecting a report");

  const current = await Report.findOne({ reportId: req.params.id });
  if (!current) throw new ApiError(404, "NOT_FOUND", "Report not found");
  const from = current.verificationStatus;
  const allowed = action === "approve" ? ["needs_review", "pending"] : ["needs_review", "pending", "verified"];
  const to = action === "approve" ? "verified" : "rejected";

  // the status is part of the filter, so if two moderators act at once, the second one loses (UC-03)
  const report = allowed.includes(from) ? await Report.findOneAndUpdate({ reportId: current.reportId, verificationStatus: from }, { verificationStatus: to, verifiedBy: "moderator", ...(categoryOverride ? { category: categoryOverride } : {}) }, { new: true }) : null;
  if (!report) throw new ApiError(409, "ALREADY_DECIDED", `This report is already ${from.replace("_", " ")}. Refresh the queue.`);

  await VerificationLog.create({ reportId: report.reportId, actor: req.user?.email || "unknown", fromStatus: from, toStatus: to, comment });
  const s = await Source.findOneAndUpdate({ sourceId: report.sourceId ?? `${report.sourceType}:anonymous` }, { $inc: action === "approve" ? { approvedCount: 1 } : { rejectedCount: 1 } }, { new: true });
  if (s && !s.allowListed) { s.reliability = +((s.approvedCount + 2) / (s.approvedCount + s.rejectedCount + 5)).toFixed(3); await s.save(); } // SRS 8.4
  publishReport(report);
  res.json(report);
});

// GET /api/admin/reports/:id/audit
router.get("/reports/:id/audit", async (req: Request, res: Response) => {
  res.json({ items: await VerificationLog.find({ reportId: req.params.id }).sort({ at: -1 }).select("-__v") });
});

// POST /api/admin/clusters/:id/merge: fold this cluster into another one (SRS FR-DED-07)
router.post("/clusters/:id/merge", validate(z.object({ targetClusterId: z.string().min(1) })), async (req: Request, res: Response) => {
  const [from, to] = await Promise.all([Cluster.findOne({ clusterId: req.params.id }), Cluster.findOne({ clusterId: req.body.targetClusterId })]);
  if (!from || !to) throw new ApiError(404, "NOT_FOUND", "Cluster not found");
  if (from.clusterId === to.clusterId) throw new ApiError(400, "SAME_CLUSTER", "Choose a different cluster to merge into");
  await Report.updateMany({ clusterId: from.clusterId }, { clusterId: to.clusterId });
  const total = from.reportCount + to.reportCount;
  if (from.centroid && to.centroid) to.centroid = { type: "Point", coordinates: [(from.centroid.coordinates[0] * from.reportCount + to.centroid.coordinates[0] * to.reportCount) / total, (from.centroid.coordinates[1] * from.reportCount + to.centroid.coordinates[1] * to.reportCount) / total] };
  to.sources = [...new Set([...to.sources, ...from.sources])]; to.sourceCount = to.sources.length; to.reportCount = total;
  to.firstSeenAt = new Date(Math.min(from.firstSeenAt.getTime(), to.firstSeenAt.getTime())); to.lastSeenAt = new Date(Math.max(from.lastSeenAt.getTime(), to.lastSeenAt.getTime()));
  await to.save(); await from.deleteOne();
  await Report.updateMany({ clusterId: to.clusterId }, { clusterSize: total });
  res.json({ clusterId: to.clusterId, reportCount: total, sourceCount: to.sourceCount });
});

// ---------------------------------------------------------------- admin only below
const adminOnly = requireRole("admin");

router.get("/config", adminOnly, async (_req: Request, res: Response) => {
  res.json({ items: await Config.find().sort({ key: 1 }).select("-__v") });
});

router.put("/config", adminOnly, validate(z.object({ key: z.string().min(1).max(80), value: z.unknown() })), async (req: AuthedRequest, res: Response) => {
  const { key, value } = req.body;
  const problem = validateSetting(key, value);
  if (problem) throw new ApiError(400, "INVALID_SETTING", problem);
  const updated = await Config.findOneAndUpdate({ key }, { value, updatedBy: req.user?.email, updatedAt: new Date() }, { upsert: true, new: true });
  invalidateSettings();
  res.json(updated);
});

router.get("/users", adminOnly, async (_req: Request, res: Response) => {
  res.json({ items: await User.find().sort({ createdAt: 1 }).select("-passwordHash -__v") });
});

const createUserSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(100), role: z.enum(["moderator", "admin"]) });
router.post("/users", adminOnly, validate(createUserSchema), async (req: Request, res: Response) => {
  const { email, password, role } = req.body;
  if (await User.exists({ email: email.toLowerCase() })) throw new ApiError(409, "EMAIL_EXISTS", "A user with that email already exists");
  const user = await User.create({ email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10), role });
  res.status(201).json({ id: user.id, email: user.email, role: user.role });
});

const patchUserSchema = z.object({ active: z.boolean().optional(), role: z.enum(["moderator", "admin"]).optional() });
router.patch("/users/:id", adminOnly, validate(patchUserSchema), async (req: AuthedRequest, res: Response) => {
  if (req.params.id === req.user?.id && (req.body.active === false || req.body.role === "moderator")) throw new ApiError(400, "CANNOT_MODIFY_SELF", "You cannot disable or demote your own account");
  const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true }).select("-passwordHash -__v");
  if (!user) throw new ApiError(404, "NOT_FOUND", "User not found");
  res.json(user);
});

router.post("/users/:id/reset-password", adminOnly, validate(z.object({ password: z.string().min(8).max(100) })), async (req: Request, res: Response) => {
  const user = await User.findByIdAndUpdate(req.params.id, { passwordHash: await bcrypt.hash(req.body.password, 10) });
  if (!user) throw new ApiError(404, "NOT_FOUND", "User not found");
  res.json({ ok: true });
});

router.get("/sources", adminOnly, async (_req: Request, res: Response) => {
  res.json({ items: (await Source.find().sort({ reportCount: -1 })).map(sourceRow) });
});

router.patch("/sources/:id", adminOnly, validate(z.object({ blocked: z.boolean().optional(), allowListed: z.boolean().optional() })), async (req: Request, res: Response) => {
  const s = await Source.findOneAndUpdate({ sourceId: req.params.id }, req.body, { new: true });
  if (!s) throw new ApiError(404, "NOT_FOUND", "Source not found");
  res.json(sourceRow(s));
});

// GET /api/admin/pipeline: health numbers for the System Health page
router.get("/pipeline", adminOnly, async (_req: Request, res: Response) => {
  const since = new Date(Date.now() - 24 * 3600_000), fiveMin = new Date(Date.now() - 5 * 60_000);
  const [pending, dlq, perHour, last5] = await Promise.all([
    Report.countDocuments({ verificationStatus: "pending" }), FailedReport.countDocuments(),
    Report.aggregate([{ $match: { ingestedAt: { $gte: since } } }, { $group: { _id: { $dateTrunc: { date: "$ingestedAt", unit: "hour" } }, n: { $sum: 1 } } }]),
    Report.countDocuments({ ingestedAt: { $gte: fiveMin }, verificationStatus: { $ne: "pending" } }),
  ]);
  const byHour = new Map(perHour.map((x) => [new Date(x._id).getTime(), x.n as number]));
  const top = new Date(); top.setMinutes(0, 0, 0);
  const counts = Array.from({ length: 24 }, (_, i) => byHour.get(top.getTime() - (23 - i) * 3600_000) ?? 0);
  const max = Math.max(1, ...counts), spark = counts.map((c) => Math.max(1, Math.round((c / max) * 40)));
  const rate = +(last5 / 5).toFixed(1);
  res.json({ queued: pending, dlq, stages: ["Dedup", "Trust score", "Classification", "Storage"].map((name) => ({ name, lag: pending, rate, spark })) });
});

// Official alerts can be published by hand until a bulletin feed is connected
const alertSchema = z.object({
  title: z.string().min(3).max(160), severity: z.enum(["extreme", "severe", "moderate", "low"]), type: z.string().min(2).max(40),
  states: z.array(z.string()).max(10).default([]), region: z.string().min(2).max(120), description: z.string().max(1000).default(""),
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), durationHours: z.number().min(1).max(168).default(24),
});
router.post("/alerts", adminOnly, validate(alertSchema), async (req: AuthedRequest, res: Response) => {
  const { durationHours, ...rest } = req.body;
  const a = await Alert.create({ ...rest, alertId: `a-${randomUUID().slice(0, 8)}`, expiresAt: new Date(Date.now() + durationHours * 3600_000), createdBy: req.user?.email });
  res.status(201).json(a);
});
router.delete("/alerts/:id", adminOnly, async (req: Request, res: Response) => {
  const r = await Alert.deleteOne({ alertId: req.params.id });
  if (!r.deletedCount) throw new ApiError(404, "NOT_FOUND", "Alert not found");
  res.json({ ok: true });
});

export default router;
