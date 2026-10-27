/**
 * One-time generator for backend-api (text-only scope: Phases 1-3 of the checklist).
 * Run from inside the backend-api folder:   node setup-backend.js
 * Safe to re-run: it will NOT overwrite a file that already exists, it just reports it.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

function write(relPath, content) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (fs.existsSync(full)) {
    console.log("skip (exists):", relPath);
    return;
  }
  fs.writeFileSync(full, content.trimStart());
  console.log("created:      ", relPath);
}

// ---------------------------------------------------------------- package.json
write("package.json", `{
  "name": "nwbdap-backend-api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "nodemon --watch src --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "mongoose": "^8.5.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.14.0",
    "nodemon": "^3.1.4",
    "ts-node": "^10.9.2",
    "typescript": "^5.5.3"
  }
}
`);

// ---------------------------------------------------------------- tsconfig.json
write("tsconfig.json", `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
`);

// ---------------------------------------------------------------- .env.example
write(".env.example", `PORT=4000
MONGO_URI=mongodb://localhost:27017/nwbdap
JWT_SECRET=change-this-in-real-deployment
JWT_EXPIRES_IN=1h
`);

// ---------------------------------------------------------------- config/db.ts
write("src/config/db.ts", `import mongoose from "mongoose";

export async function connectDB() {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/nwbdap";
  await mongoose.connect(uri);
  console.log(\`[db] connected to \${uri}\`);
}
`);

// ---------------------------------------------------------------- models/Report.ts
write("src/models/Report.ts", `import { Schema, model, Document } from "mongoose";

export type SourceType = "citizen" | "social" | "api" | "news";
export type EventCategory =
  | "rainfall" | "thunderstorm" | "flooding" | "heatwave"
  | "fog" | "dust_storm" | "strong_winds" | "other";
export type LocationPrecision = "exact" | "city" | "state" | "unknown";
export type VerificationStatus = "pending" | "needs_review" | "verified" | "rejected";
export type VerifiedBy = "system" | "moderator" | null;

// Media is left in the schema (empty for now) so the model doesn't need to change
// when the image/video phase starts. Nothing currently writes to it.
export interface IMediaItem {
  url: string;
  type: "image" | "video";
  exifTime?: Date;
  exifLat?: number;
  exifLng?: number;
  phash?: string;
}

export interface IReport extends Document {
  reportId: string;
  sourceType: SourceType;
  sourceId?: string;
  sourceRef?: string;
  rawText: string;
  language?: string;
  hashtags: string[];
  submittedAt: Date;
  ingestedAt: Date;
  location?: { type: "Point"; coordinates: [number, number] };
  locationPrecision: LocationPrecision;
  city?: string;
  state?: string;
  district?: string;
  geohash?: string;
  media: IMediaItem[];
  claimedCategory?: EventCategory;
  clusterId?: string;
  clusterSize?: number;
  isNewCluster?: boolean;
  trustScore?: number;
  trustBreakdown?: Record<string, number>;
  trustReasons?: string[];
  category?: EventCategory;
  categoryConfidence?: number;
  lowConfidence?: boolean;
  modelVersion?: string;
  verificationStatus: VerificationStatus;
  verifiedBy?: VerifiedBy;
  stageTimes?: Record<string, Date>;
}

const MediaItemSchema = new Schema<IMediaItem>(
  {
    url: String,
    type: { type: String, enum: ["image", "video"] },
    exifTime: Date,
    exifLat: Number,
    exifLng: Number,
    phash: String,
  },
  { _id: false }
);

const ReportSchema = new Schema<IReport>({
  reportId: { type: String, required: true, unique: true },
  sourceType: { type: String, enum: ["citizen", "social", "api", "news"], required: true },
  sourceId: String,
  sourceRef: String,
  rawText: { type: String, required: true },
  language: { type: String, default: "en" },
  hashtags: { type: [String], default: [] },
  submittedAt: { type: Date, required: true, default: Date.now },
  ingestedAt: { type: Date, required: true, default: Date.now },
  location: {
    type: { type: String, enum: ["Point"], default: undefined },
    coordinates: { type: [Number], default: undefined },
  },
  locationPrecision: { type: String, enum: ["exact", "city", "state", "unknown"], default: "unknown" },
  city: String,
  state: String,
  district: String,
  geohash: String,
  media: { type: [MediaItemSchema], default: [] },
  claimedCategory: {
    type: String,
    enum: ["rainfall", "thunderstorm", "flooding", "heatwave", "fog", "dust_storm", "strong_winds", "other"],
  },
  clusterId: String,
  clusterSize: Number,
  isNewCluster: Boolean,
  trustScore: { type: Number, min: 0, max: 100 },
  trustBreakdown: { type: Schema.Types.Mixed },
  trustReasons: { type: [String], default: [] },
  category: {
    type: String,
    enum: ["rainfall", "thunderstorm", "flooding", "heatwave", "fog", "dust_storm", "strong_winds", "other"],
  },
  categoryConfidence: Number,
  lowConfidence: Boolean,
  modelVersion: String,
  verificationStatus: {
    type: String,
    enum: ["pending", "needs_review", "verified", "rejected"],
    default: "pending",
  },
  verifiedBy: { type: String, enum: ["system", "moderator", null], default: null },
  stageTimes: { type: Schema.Types.Mixed },
});

ReportSchema.index({ location: "2dsphere" });
ReportSchema.index({ submittedAt: -1 });
ReportSchema.index({ category: 1, verificationStatus: 1, submittedAt: -1 });
ReportSchema.index({ state: 1, submittedAt: -1 });
ReportSchema.index({ clusterId: 1 });
ReportSchema.index({ sourceId: 1 });

export const Report = model<IReport>("Report", ReportSchema);
`);

// ---------------------------------------------------------------- models/Cluster.ts
write("src/models/Cluster.ts", `import { Schema, model, Document } from "mongoose";

export interface ICluster extends Document {
  clusterId: string;
  category?: string;
  centroid?: { type: "Point"; coordinates: [number, number] };
  reportCount: number;
  sourceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const ClusterSchema = new Schema<ICluster>({
  clusterId: { type: String, required: true, unique: true },
  category: String,
  centroid: {
    type: { type: String, enum: ["Point"], default: undefined },
    coordinates: { type: [Number], default: undefined },
  },
  reportCount: { type: Number, default: 0 },
  sourceCount: { type: Number, default: 0 },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
});

ClusterSchema.index({ centroid: "2dsphere" });
ClusterSchema.index({ lastSeenAt: -1 });

export const Cluster = model<ICluster>("Cluster", ClusterSchema);
`);

// ---------------------------------------------------------------- models/Source.ts
write("src/models/Source.ts", `import { Schema, model, Document } from "mongoose";

export interface ISource extends Document {
  sourceId: string;
  type: "citizen" | "social" | "api" | "news";
  reliability: number;
  reportCount: number;
  approvedCount: number;
  rejectedCount: number;
  blocked: boolean;
  allowListed: boolean;
}

const SourceSchema = new Schema<ISource>({
  sourceId: { type: String, required: true, unique: true },
  type: { type: String, enum: ["citizen", "social", "api", "news"], required: true },
  reliability: { type: Number, default: 0.4, min: 0, max: 1 },
  reportCount: { type: Number, default: 0 },
  approvedCount: { type: Number, default: 0 },
  rejectedCount: { type: Number, default: 0 },
  blocked: { type: Boolean, default: false },
  allowListed: { type: Boolean, default: false },
});

export const Source = model<ISource>("Source", SourceSchema);
`);

// ---------------------------------------------------------------- models/User.ts
write("src/models/User.ts", `import { Schema, model, Document } from "mongoose";

export type UserRole = "moderator" | "admin";

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  lastLoginAt?: Date;
}

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["moderator", "admin"], required: true },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: Date,
});

export const User = model<IUser>("User", UserSchema);
`);

// ---------------------------------------------------------------- models/VerificationLog.ts
write("src/models/VerificationLog.ts", `import { Schema, model, Document } from "mongoose";

export interface IVerificationLog extends Document {
  reportId: string;
  actor: string; // "system" or a user's email/id
  fromStatus: string;
  toStatus: string;
  comment?: string;
  at: Date;
}

const VerificationLogSchema = new Schema<IVerificationLog>({
  reportId: { type: String, required: true },
  actor: { type: String, required: true },
  fromStatus: { type: String, required: true },
  toStatus: { type: String, required: true },
  comment: String,
  at: { type: Date, default: Date.now },
});

VerificationLogSchema.index({ reportId: 1, at: -1 });

export const VerificationLog = model<IVerificationLog>("VerificationLog", VerificationLogSchema);
`);

// ---------------------------------------------------------------- models/Config.ts
write("src/models/Config.ts", `import { Schema, model, Document } from "mongoose";

export interface IConfig extends Document {
  key: string;
  value: unknown;
  updatedBy?: string;
  updatedAt: Date;
}

const ConfigSchema = new Schema<IConfig>({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true },
  updatedBy: String,
  updatedAt: { type: Date, default: Date.now },
});

export const Config = model<IConfig>("Config", ConfigSchema);
`);

// ---------------------------------------------------------------- middleware/errorHandler.ts
write("src/middleware/errorHandler.ts", `import { Request, Response, NextFunction } from "express";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  console.error("[unhandled error]", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
}
`);

// ---------------------------------------------------------------- middleware/validate.ts
write("src/middleware/validate.ts", `import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { ApiError } from "./errorHandler";

// Usage: router.post("/", validate(schema), handler)
export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues.map((i) => \`\${i.path.join(".")}: \${i.message}\`).join("; ");
      return next(new ApiError(400, "VALIDATION_ERROR", message));
    }
    req.body = result.data;
    next();
  };
}
`);

// ---------------------------------------------------------------- middleware/auth.ts
write("src/middleware/auth.ts", `import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { ApiError } from "./errorHandler";

export interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: "moderator" | "admin" };
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new ApiError(401, "UNAUTHENTICATED", "Missing or invalid Authorization header"));
  }
  try {
    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret") as AuthedRequest["user"];
    req.user = payload;
    next();
  } catch {
    next(new ApiError(401, "UNAUTHENTICATED", "Invalid or expired token"));
  }
}

export function requireRole(...roles: Array<"moderator" | "admin">) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, "FORBIDDEN", "You do not have permission to do this"));
    }
    next();
  };
}
`);

// ---------------------------------------------------------------- routes/reports.ts
write("src/routes/reports.ts", `import { Router, Request, Response } from "express";
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
`);

// ---------------------------------------------------------------- routes/analytics.ts
write("src/routes/analytics.ts", `import { Router, Request, Response } from "express";
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
`);

// ---------------------------------------------------------------- routes/auth.ts
write("src/routes/auth.ts", `import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { User } from "../models/User";
import { validate } from "../middleware/validate";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", validate(loginSchema), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase(), active: true });
  if (!user) throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");

  user.lastLoginAt = new Date();
  await user.save();

  const expiresIn = (process.env.JWT_EXPIRES_IN || "1h") as jwt.SignOptions["expiresIn"];
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || "dev-secret",
    { expiresIn }
  );

  res.json({ token, role: user.role, email: user.email });
});

router.get("/me", requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user });
});

export default router;
`);

// ---------------------------------------------------------------- routes/admin.ts
write("src/routes/admin.ts", `import { Router, Request, Response } from "express";
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
`);

// ---------------------------------------------------------------- index.ts
write("src/index.ts", `import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db";
import { errorHandler } from "./middleware/errorHandler";
import reportsRouter from "./routes/reports";
import analyticsRouter from "./routes/analytics";
import authRouter from "./routes/auth";
import adminRouter from "./routes/admin";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" })); // text-only for now; raise this when media uploads are added

app.get("/health", (_req, res) => res.json({ status: "ok", service: "backend-api" }));

app.use("/api/reports", reportsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);

app.use(errorHandler);

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(\`[backend-api] listening on :\${PORT}\`));
  })
  .catch((err) => {
    console.error("[backend-api] failed to connect to DB", err);
    process.exit(1);
  });
`);

console.log("\nDone. Next steps:");
console.log("  1. npm install");
console.log("  2. copy .env.example to .env");
console.log("  3. npm run dev");
