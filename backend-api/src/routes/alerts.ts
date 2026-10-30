import { Router, Request, Response } from "express";
import { Alert } from "../models/Alert";
import { computeHotspots, hotspotAlert } from "../services/hotspots";

const router = Router();

// GET /api/alerts: published alerts that have not expired, plus live community hotspots
router.get("/", async (_req: Request, res: Response) => {
  const [stored, hotspots] = await Promise.all([Alert.find({ expiresAt: { $gt: new Date() } }).sort({ issuedAt: -1 }), computeHotspots()]);
  const mapped = stored.map((a) => ({ id: a.alertId, title: a.title, severity: a.severity, type: a.type, states: a.states, region: a.region, issuedAt: a.issuedAt.toISOString(), expiresAt: a.expiresAt.toISOString(), description: a.description, source: a.source, lat: a.lat, lng: a.lng }));
  const live = await Promise.all(hotspots.map(hotspotAlert));
  const order = { extreme: 0, severe: 1, moderate: 2, low: 3 } as const;
  res.json({ items: [...mapped, ...live].sort((a, b) => order[a.severity as keyof typeof order] - order[b.severity as keyof typeof order]) });
});

export default router;
