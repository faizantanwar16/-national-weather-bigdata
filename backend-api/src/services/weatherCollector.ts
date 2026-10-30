// Optional: when OPENWEATHER_API_KEY is set, this polls official observations for a list of cities and stores the
// notable ones as "api" reports. They feed the official-data-match trust signal (SRS FR-ING-02, FR-TRU-04).
import { randomUUID } from "crypto";
import { Report } from "../models/Report";
import { Source } from "../models/Source";
import { resolvePlace } from "./gazetteer";
import { geohashEncode } from "./geo";
import { getSetting } from "./settings";
import { enqueue } from "./pipeline";
import { fetchCurrent } from "../routes/weather";

export async function ensureOfficialSources() {
  for (const id of ["api:imd", "api:openweathermap"]) {
    await Source.updateOne({ sourceId: id }, { $setOnInsert: { sourceId: id, type: "api", reliability: 0.95, allowListed: true, blocked: false, reportCount: 0, approvedCount: 0, rejectedCount: 0 } }, { upsert: true });
  }
}

async function pollOnce() {
  const cities = await getSetting<string[]>("collectors.api.cities");
  for (const name of cities) {
    try {
      const p = resolvePlace(name);
      if (!p) continue;
      const w = await fetchCurrent(name);
      const precip = w.rainMm, wind = w.windMs * 3.6;
      const notable = precip > 0 || w.temp >= 40 || w.visibilityKm * 1000 < 1000 || wind >= 40;
      if (!notable) continue;
      const text = `Observation: ${w.desc}, ${Math.round(w.temp)} C, wind ${Math.round(wind)} km/h, visibility ${w.visibilityKm} km${precip ? `, rain ${precip} mm/h` : ""}`;
      const now = new Date();
      await Report.create({
        reportId: randomUUID(), sourceType: "api", sourceId: "api:openweathermap", rawText: text, submittedAt: now, ingestedAt: now,
        location: { type: "Point", coordinates: [p.lng, p.lat] }, locationPrecision: "city", city: p.city, state: p.state, geohash: geohashEncode(p.lat, p.lng),
        observation: { precipMm: precip, tempC: w.temp, visibilityM: w.visibilityKm * 1000, windKmh: wind, cloudPct: w.cloud }, verificationStatus: "pending",
        claimedCategory: precip > 0 ? "rainfall" : w.temp >= 40 ? "heatwave" : w.visibilityKm * 1000 < 1000 ? "fog" : "strong_winds",
      }).then((r) => enqueue(r.reportId));
    } catch (e) { console.warn(`[collector] ${name}:`, (e as Error).message); }
  }
}

export async function startWeatherCollector() {
  await ensureOfficialSources();
  if (process.env.DISABLE_WEATHER_COLLECTOR === "true" || process.env.PIPELINE_MODE === "external") {
    console.log("[collector] Weather collector disabled (Python is handling official observations)");
    return;
  }
  if (!process.env.OPENWEATHER_API_KEY) { console.log("[collector] OPENWEATHER_API_KEY not set: official observations are off"); return; }
  const loop = async () => { await pollOnce().catch(() => undefined); const sec = await getSetting<number>("collectors.api.intervalSec"); setTimeout(loop, sec * 1000).unref(); };
  loop();
}
