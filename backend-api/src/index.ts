import "express-async-errors"; // lets `throw new ApiError(...)` inside async routes reach the error handler
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { connectDB } from "./config/db";
import { errorHandler } from "./middleware/errorHandler";
import { loginLimiter, readLimiter } from "./middleware/rateLimit";
import reportsRouter from "./routes/reports";
import analyticsRouter from "./routes/analytics";
import authRouter from "./routes/auth";
import adminRouter from "./routes/admin";
import mediaRouter, { UPLOAD_DIR } from "./routes/media";
import streamRouter from "./routes/stream";
import clustersRouter from "./routes/clusters";
import alertsRouter from "./routes/alerts";
import weatherRouter from "./routes/weather";
import exportRouter from "./routes/export";
import { ensureDefaults } from "./services/settings";
import { startPipeline } from "./services/pipeline";
import { startWeatherCollector } from "./services/weatherCollector";

const app = express();
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1); // so rate limits see real client IPs behind a proxy

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } })); // photos are shown on the dashboard origin
const origins = (process.env.CLIENT_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173").split(",").map((s) => s.trim());
app.use(cors({ origin: origins })); // only the dashboard may call the API from a browser (SRS NFR-SEC-08)
app.use(express.json({ limit: "100kb" }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d", index: false, dotfiles: "deny" }));

app.get("/health", (_req, res) => res.json({ status: "ok", service: "backend-api" }));

app.use("/api/stream", streamRouter); // no rate limit: it is one long-lived connection
app.use("/api/auth/login", loginLimiter);
app.use("/api", readLimiter);
app.use("/api/reports", reportsRouter);
app.use("/api/media", mediaRouter);
app.use("/api/clusters", clustersRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/weather", weatherRouter);
app.use("/api/export", exportRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);

app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "No such endpoint" } }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;

connectDB()
  .then(async () => {
    if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) throw new Error("JWT_SECRET must be set in production");
    await ensureDefaults();
    startPipeline();
    startWeatherCollector().catch((e) => console.warn("[collector]", e));
    app.listen(PORT, () => console.log(`[backend-api] listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("[backend-api] failed to start", err);
    process.exit(1);
  });
