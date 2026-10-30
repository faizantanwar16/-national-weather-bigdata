import { Router, Request, Response } from "express";
import { z } from "zod";
import { ApiError } from "../middleware/errorHandler";
import { parseQuery } from "../middleware/validate";
import { resolvePlace } from "../services/gazetteer";

export interface Current { desc: string; temp: number; feels: number; high: number; low: number; humidity: number; windMs: number; windDeg: number; visibilityKm: number; pressure: number; cloud: number; rainMm: number; rain: boolean; lat: number; lon: number }
const cache = new Map<string, { at: number; data: Current }>();
const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export async function fetchCurrent(city: string): Promise<Current> {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) throw new ApiError(501, "NOT_CONFIGURED", "Set OPENWEATHER_API_KEY in backend-api/.env to enable live conditions");
  const hit = cache.get(city.toLowerCase());
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
  const p = resolvePlace(city);
  const where = p ? `lat=${p.lat}&lon=${p.lng}` : `q=${encodeURIComponent(city)},IN`;
  const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?${where}&units=metric&appid=${key}`);
  if (!res.ok) throw new ApiError(502, "UPSTREAM_ERROR", `Weather provider answered ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = await res.json();
  const data: Current = {
    desc: String(j.weather?.[0]?.description ?? "clear sky").replace(/^./, (c: string) => c.toUpperCase()), temp: Math.round(j.main.temp), feels: Math.round(j.main.feels_like),
    high: Math.round(j.main.temp_max), low: Math.round(j.main.temp_min), humidity: j.main.humidity, windMs: j.wind?.speed ?? 0, windDeg: j.wind?.deg ?? 0,
    visibilityKm: +((j.visibility ?? 10000) / 1000).toFixed(1), pressure: j.main.pressure, cloud: j.clouds?.all ?? 0, rainMm: j.rain?.["1h"] ?? 0,
    rain: ["Rain", "Drizzle", "Thunderstorm"].includes(j.weather?.[0]?.main), lat: j.coord.lat, lon: j.coord.lon,
  };
  cache.set(city.toLowerCase(), { at: Date.now(), data });
  return data;
}

const router = Router();

// GET /api/weather?city=Nagpur  -> current official conditions (used by the Overview page)
router.get("/", async (req: Request, res: Response) => {
  const { city } = parseQuery(z.object({ city: z.string().min(2).max(60) }), req.query);
  if (!process.env.OPENWEATHER_API_KEY) return res.json({ configured: false, message: "Set OPENWEATHER_API_KEY in backend-api/.env to enable live conditions" });
  const w = await fetchCurrent(city);
  let aqi = 0;
  try {
    const a = await fetch(`https://api.openweathermap.org/data/2.5/air_pollution?lat=${w.lat}&lon=${w.lon}&appid=${process.env.OPENWEATHER_API_KEY}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (a.ok) aqi = ({ 1: 40, 2: 90, 3: 140, 4: 200, 5: 300 } as Record<number, number>)[((await a.json()) as any).list?.[0]?.main?.aqi] ?? 0;
  } catch { /* air quality is optional */ }
  const p = resolvePlace(city);
  res.json({
    city: p?.city ?? city, state: p?.state ?? "", temp: w.temp, feels: w.feels, desc: w.desc, high: w.high, low: w.low, humidity: w.humidity,
    wind: +w.windMs.toFixed(1), windDir: DIRS[Math.round(w.windDeg / 45) % 8], visibility: w.visibilityKm, pressure: w.pressure, cloud: w.cloud,
    uv: 0, aqi, rain: w.rain, sample: false,
  });
});

export default router;
