import { Config } from "../models/Config";

// Runtime settings (SRS 6.4). Defaults live here; admins override them in the config collection.
interface Meta { default: unknown; kind: "number" | "list"; min?: number; max?: number }
export const SETTINGS: Record<string, Meta> = {
  "trust.autoVerifyThreshold": { default: 75, kind: "number", min: 0, max: 100 },
  "classification.minConfidence": { default: 0.5, kind: "number", min: 0, max: 1 },
  "dedup.maxDistanceKm": { default: 10, kind: "number", min: 1, max: 100 },
  "dedup.windowMinutes": { default: 120, kind: "number", min: 10, max: 720 },
  "dedup.similarityThreshold": { default: 0.6, kind: "number", min: 0.3, max: 0.95 },
  "hotspot.minSources": { default: 5, kind: "number", min: 2, max: 20 },
  "hotspot.radiusKm": { default: 10, kind: "number", min: 1, max: 100 },
  "hotspot.windowMinutes": { default: 60, kind: "number", min: 10, max: 720 },
  "collectors.social.intervalSec": { default: 60, kind: "number", min: 15, max: 600 },
  "collectors.api.intervalSec": { default: 900, kind: "number", min: 300, max: 3600 },
  "collectors.hashtags": { default: ["#IMD", "#rainfall", "#flood", "#heatwave", "#thunderstorm", "#fog", "#duststorm"], kind: "list" },
  "collectors.api.cities": { default: ["Delhi", "Mumbai", "Chennai", "Kolkata", "Nagpur", "Guwahati"], kind: "list" },
};

let cache: { at: number; map: Map<string, unknown> } | null = null;

export function invalidateSettings() { cache = null; }

async function load() {
  if (cache && Date.now() - cache.at < 15_000) return cache.map;
  const rows = await Config.find().lean();
  cache = { at: Date.now(), map: new Map(rows.map((r) => [r.key, r.value])) };
  return cache.map;
}

export async function getSetting<T = number>(key: string): Promise<T> {
  const map = await load();
  return (map.has(key) ? map.get(key) : SETTINGS[key]?.default) as T;
}

export async function ensureDefaults() {
  for (const [key, m] of Object.entries(SETTINGS)) {
    await Config.updateOne({ key }, { $setOnInsert: { key, value: m.default, updatedBy: "system", updatedAt: new Date() } }, { upsert: true });
  }
}

/** Returns an error message, or null when the value is acceptable (UC-04 alternative flow). */
export function validateSetting(key: string, value: unknown): string | null {
  const m = SETTINGS[key];
  if (!m) return null;
  if (m.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${key} must be a number`;
    if (m.min !== undefined && value < m.min) return `${key} must be at least ${m.min}`;
    if (m.max !== undefined && value > m.max) return `${key} must be at most ${m.max}`;
    return null;
  }
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) return `${key} must be a list of text values`;
  return null;
}
