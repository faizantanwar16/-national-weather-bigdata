import { Router, Request, Response } from "express";
import { hub } from "../services/events";

const router = Router();

// GET /api/stream: Server-Sent Events. Events: "report" (new or updated) and "alert" (new hotspot).
router.get("/", (req: Request, res: Response) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 5000\n\n");
  const send = (event: string) => (data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const onReport = send("report"), onAlert = send("alert");
  hub.on("report", onReport); hub.on("alert", onAlert);
  const beat = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => { clearInterval(beat); hub.off("report", onReport); hub.off("alert", onAlert); });
});

export default router;
