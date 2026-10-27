import "dotenv/config";
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
    app.listen(PORT, () => console.log(`[backend-api] listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("[backend-api] failed to connect to DB", err);
    process.exit(1);
  });
