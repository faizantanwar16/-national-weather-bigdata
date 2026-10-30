import { Request, Response, NextFunction } from "express";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// One error format for the whole API: { error: { code, message } }  (SRS FR-API-01)
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  const e = err as { name?: string; code?: unknown; type?: string; message?: string };
  if (e?.name === "MulterError") {
    const tooBig = e.code === "LIMIT_FILE_SIZE";
    return res.status(tooBig ? 413 : 400).json({ error: { code: tooBig ? "FILE_TOO_LARGE" : "UPLOAD_ERROR", message: tooBig ? "File is too large (images 5 MB, video 25 MB)" : e.message || "Upload failed" } });
  }
  if (e?.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "BAD_JSON", message: "Request body is not valid JSON" } });
  }
  if (e?.code === 11000) {
    return res.status(409).json({ error: { code: "DUPLICATE", message: "That record already exists" } });
  }
  if (e?.name === "CastError") {
    return res.status(400).json({ error: { code: "BAD_ID", message: "Invalid id" } });
  }
  console.error("[unhandled error]", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
}
