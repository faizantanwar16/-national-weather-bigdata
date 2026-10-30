import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { createHash, randomBytes } from "crypto";
import { ApiError } from "../middleware/errorHandler";
import { mediaLimiter } from "../middleware/rateLimit";

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MB = 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * MB, files: 1 } });

// The file type is decided from the file's first bytes, never from its name or declared type (SRS NFR-SEC-06).
function sniff(b: Buffer): { ext: "jpg" | "png" | "webp" | "mp4"; type: "image" | "video" } | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image" };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image" };
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", type: "image" };
  if (b.subarray(4, 8).toString("latin1") === "ftyp") return { ext: "mp4", type: "video" };
  return null;
}

const router = Router();

// POST /api/media (multipart, field name "file"): store one image or video, return its URL
router.post("/", mediaLimiter, upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) throw new ApiError(400, "NO_FILE", "Attach a file in the form field named \"file\"");
  const kind = sniff(req.file.buffer);
  if (!kind) throw new ApiError(415, "UNSUPPORTED_TYPE", "Only JPEG, PNG, WebP images and MP4 video are allowed");
  if (kind.type === "image" && req.file.size > 5 * MB) throw new ApiError(413, "FILE_TOO_LARGE", "Images must be 5 MB or smaller");
  const hash = createHash("sha256").update(req.file.buffer).digest("hex").slice(0, 16); // same file twice -> same prefix
  const name = `${hash}-${randomBytes(4).toString("hex")}.${kind.ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), req.file.buffer);
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  res.status(201).json({ url: `${base}/uploads/${name}`, type: kind.type });
});

export default router;
