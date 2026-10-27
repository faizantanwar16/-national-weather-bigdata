import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Report } from "../models/Report";
import { User } from "../models/User";
import { Config } from "../models/Config";
import { VerificationLog } from "../models/VerificationLog";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { ApiError } from "../middleware/errorHandler";

const router = Router();
router.use(requireAuth, requireRole("moderator", "admin"));

// GET /api/admin/queue — reports needing review, lowest trust score first
router.get("/queue", async (req: Request, res: Response) => {
  const { category, state } = req.query;
  const filter: Record<string, unknown> = { verificationStatus: "needs_review" };
  if (category) filter.category = category;
  if (state) filter.state = state;

  const items = await Report.find(filter).sort({ trustScore: 1, submittedAt: -1 }).limit(100);
  res.json({ items });
});

const verifySchema = z.object({
  action: z.enum(["approve", "reject"]),
  comment: z.string().optional(),
  categoryOverride: z
    .enum(["rainfall", "thunderstorm", "flooding", "heatwave", "fog", "dust_storm", "strong_winds", "other"])
    .optional(),
});

// PATCH /api/admin/reports/:id/verify
router.patch("/reports/:id/verify", validate(verifySchema), async (req: AuthedRequest, res: Response) => {
  const { action, comment, categoryOverride } = req.body;
  if (action === "reject" && !comment) {
    throw new ApiError(400, "COMMENT_REQUIRED", "A comment is required when rejecting a report");
  }

  const report = await Report.findOne({ reportId: req.params.id });
  if (!report) throw new ApiError(404, "NOT_FOUND", "Report not found");

  const fromStatus = report.verificationStatus;
  report.verificationStatus = action === "approve" ? "verified" : "rejected";
  report.verifiedBy = "moderator";
  if (categoryOverride) report.category = categoryOverride;
  await report.save();

  await VerificationLog.create({
    reportId: report.reportId,
    actor: req.user?.email || "unknown",
    fromStatus,
    toStatus: report.verificationStatus,
    comment,
  });

  res.json(report);
});

// GET /api/admin/reports/:id/audit
router.get("/reports/:id/audit", async (req: Request, res: Response) => {
  const logs = await VerificationLog.find({ reportId: req.params.id }).sort({ at: -1 });
  res.json({ items: logs });
});

// GET/PUT /api/admin/config
router.get("/config", requireRole("admin"), async (_req: Request, res: Response) => {
  const items = await Config.find();
  res.json({ items });
});

const configUpdateSchema = z.object({ key: z.string(), value: z.unknown() });

router.put("/config", requireRole("admin"), validate(configUpdateSchema), async (req: AuthedRequest, res: Response) => {
  const { key, value } = req.body;
  const updated = await Config.findOneAndUpdate(
    { key },
    { value, updatedBy: req.user?.email, updatedAt: new Date() },
    { upsert: true, new: true }
  );
  res.json(updated);
});

// GET/POST/PATCH /api/admin/users
router.get("/users", requireRole("admin"), async (_req: Request, res: Response) => {
  const items = await User.find().select("-passwordHash");
  res.json({ items });
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["moderator", "admin"]),
});

router.post("/users", requireRole("admin"), validate(createUserSchema), async (req: Request, res: Response) => {
  const { email, password, role } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ email: email.toLowerCase(), passwordHash, role });
  res.status(201).json({ id: user.id, email: user.email, role: user.role });
});

const patchUserSchema = z.object({ active: z.boolean().optional(), role: z.enum(["moderator", "admin"]).optional() });

router.patch("/users/:id", requireRole("admin"), validate(patchUserSchema), async (req: Request, res: Response) => {
  const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true }).select("-passwordHash");
  if (!user) throw new ApiError(404, "NOT_FOUND", "User not found");
  res.json(user);
});

export default router;
