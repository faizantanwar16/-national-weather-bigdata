// Data gateway: talks to your real backend, and falls back to realistic demo data
// when the server can't be reached (or VITE_DEMO=1). Shapes follow SRS sections 6 and 7.
import { useEffect, useRef, useState } from "react";
import * as api from "./client";
import type { AdminUser, ReportFilters } from "./client";
import type { AuditLogEntry, ConfigEntry, EventCategory, Report } from "./types";

export const API_URL: string = import.meta.env.VITE_API_URL || "http://localhost:4000";
export interface Media { url: string; type: "image" | "video" }
export interface Rep extends Report { sourceId?: string; district?: string; stageTimes?: Record<string, string>; lowConfidence?: boolean; media: Media[] }
export interface SourceRow { id: string; type: string; reliability: number; reportCount: number; approved: number; rejected: number; blocked: boolean; allowListed: boolean }
export interface Health { stages: { name: string; lag: number; rate: number; spark: number[] }[]; dlq: number; queued: number }
export interface Detail { report: Rep; cluster: Rep[]; source: SourceRow | null }

export const CAT_COLOR: Record<EventCategory, string> = { rainfall: "#38BDF8", thunderstorm: "#A78BFA", flooding: "#3B82F6", heatwave: "#F87171", fog: "#94A3B8", dust_storm: "#D4A24C", strong_winds: "#34D399", other: "#CBD5E1" };
export const CAT_ICON: Record<EventCategory, string> = { rainfall: "🌧️", thunderstorm: "⛈️", flooding: "🌊", heatwave: "🔥", fog: "🌫️", dust_storm: "🌪️", strong_winds: "💨", other: "❔" };

export const CITIES: [string, string, number, number, string][] = [
  ["Wardha", "Maharashtra", 20.7453, 78.6022, "central"], ["Nagpur", "Maharashtra", 21.1458, 79.0882, "central"], ["Mumbai", "Maharashtra", 19.076, 72.8777, "coast"], ["Pune", "Maharashtra", 18.5204, 73.8567, "central"],
  ["Delhi", "Delhi", 28.6139, 77.209, "north"], ["Chandigarh", "Chandigarh", 30.7333, 76.7794, "north"], ["Jaipur", "Rajasthan", 26.9124, 75.7873, "north"], ["Lucknow", "Uttar Pradesh", 26.8467, 80.9462, "north"],
  ["Patna", "Bihar", 25.5941, 85.1376, "east"], ["Kolkata", "West Bengal", 22.5726, 88.3639, "east"], ["Bhubaneswar", "Odisha", 20.2961, 85.8245, "east"], ["Guwahati", "Assam", 26.1445, 91.7362, "east"],
  ["Imphal", "Manipur", 24.817, 93.9368, "east"], ["Ranchi", "Jharkhand", 23.3441, 85.3096, "east"], ["Raipur", "Chhattisgarh", 21.2514, 81.6296, "central"], ["Bhopal", "Madhya Pradesh", 23.2599, 77.4126, "central"],
  ["Indore", "Madhya Pradesh", 22.7196, 75.8577, "central"], ["Ahmedabad", "Gujarat", 23.0225, 72.5714, "coast"], ["Surat", "Gujarat", 21.1702, 72.8311, "coast"], ["Hyderabad", "Telangana", 17.385, 78.4867, "central"],
  ["Visakhapatnam", "Andhra Pradesh", 17.6868, 83.2185, "coast"], ["Chennai", "Tamil Nadu", 13.0827, 80.2707, "coast"], ["Bengaluru", "Karnataka", 12.9716, 77.5946, "central"], ["Mangaluru", "Karnataka", 12.9141, 74.856, "coast"],
  ["Kochi", "Kerala", 9.9312, 76.2673, "coast"], ["Thiruvananthapuram", "Kerala", 8.5241, 76.9366, "coast"], ["Panaji", "Goa", 15.4909, 73.8278, "coast"], ["Dehradun", "Uttarakhand", 30.3165, 78.0322, "hill"],
  ["Shimla", "Himachal Pradesh", 31.1048, 77.1734, "hill"], ["Srinagar", "Jammu & Kashmir", 34.0837, 74.7973, "hill"],
];
export const STATES = [...new Set(CITIES.map((c) => c[1]))].sort();
export const distKm = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
export const nearestCity = (lat: number, lng: number) => CITIES.reduce((b, c) => (distKm([lat, lng], [c[2], c[3]]) < distKm([lat, lng], [b[2], b[3]]) ? c : b));

// ---------- demo mode switch ----------
let demo = import.meta.env.VITE_DEMO === "1";
const subs = new Set<() => void>();
export const isDemo = () => demo;
function setDemo(v: boolean) { if (demo !== v) { demo = v; subs.forEach((f) => f()); } }
export const enterDemo = () => setDemo(true);
export function useDemo() {
  const [d, setD] = useState(demo);
  useEffect(() => { const f = () => setD(demo); subs.add(f); return () => { subs.delete(f); }; }, []);
  return d;
}
async function live<T>(fn: () => Promise<T>, fb: () => T | Promise<T>): Promise<T> {
  if (demo) return fb();
  try { return await fn(); } catch (e) { if (e instanceof TypeError) { setDemo(true); return fb(); } throw e; }
}
async function raw<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem("nwbdap_token");
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `Not available yet (${res.status}). Your backend needs this endpoint from SRS 7.1.`);
  return data as T;
}

// ---------- demo data ----------
const NOW = Date.now(), MIN = 60000, HR = 3600000, DAY = 86400000;
function rng(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
const TEXT: Record<EventCategory, string[]> = {
  rainfall: ["Heavy rain since morning in {c}, visibility is low", "Steady downpour over {c}, schools sending kids home early", "{c} mein baarish ruk nahi rahi, sadkon par paani", "Rain turning heavy near {c} railway station"],
  flooding: ["Water logging on the main road in {c}, vehicles stuck", "River overflowing near the bridge in {c}, road submerged", "{c} mein baadh jaisi halat, ghar mein paani ghus gaya", "Low-lying colonies in {c} are under knee-deep water"],
  thunderstorm: ["Loud thunder and lightning over {c} for the last hour", "Lightning struck a transformer near {c}, power cut", "{c} mein bijli kadak rahi hai, tez toofan"],
  heatwave: ["45 degrees and no relief in {c}, loo chal rahi hai", "Scorching heat in {c}, roads empty at noon", "{c} mein garmi ne record tod diya"],
  fog: ["Dense fog in {c}, visibility under 50 metres", "{c} mein kohra bahut ghana hai, flights delayed", "Morning mist so thick near {c} that headlights barely help"],
  dust_storm: ["Dust storm rolling in over the highway near {c}", "{c} mein aandhi, sab kuch dhool se dhaka", "Sky turned orange with dust around {c}"],
  strong_winds: ["Trees uprooted by strong winds in {c}", "Gusty winds tearing hoardings across {c}", "{c} mein tez hawa, bijli ke taar toote"],
  other: ["Hailstones the size of marbles in {c}", "Strange sudden cold snap in {c} this evening"],
};
const FAKE = ["WORLD ENDING!!! CYCLONE HITTING NOW SHARE SHARE SHARE", "flood", "rain #rain #rain #flood #news #breaking https://x.co/a1 https://x.co/b2", "ALL CITIES WILL DROWN TONIGHT FORWARD TO EVERYONE"];
const REL: Record<string, number> = { "api:imd": 0.98, "api:openweathermap": 0.9, "news:thehindu": 0.78, "news:timesofindia": 0.74, "social:@weather_watch_in": 0.62, "social:@city_updates": 0.45, "social:@rain_alerts": 0.5, "citizen:anonymous": 0.4 };
const SRC = Object.keys(REL);
const W: Record<string, Partial<Record<EventCategory, number>>> = {
  coast: { rainfall: 5, flooding: 3, thunderstorm: 2, strong_winds: 2, other: 0.5 }, east: { rainfall: 4, flooding: 3, thunderstorm: 3, strong_winds: 1, fog: 1, other: 0.5 },
  central: { rainfall: 3, thunderstorm: 3, heatwave: 2, dust_storm: 1, strong_winds: 1, flooding: 1.5, other: 0.5 }, north: { fog: 3, heatwave: 2, dust_storm: 2, rainfall: 2, thunderstorm: 1.5, strong_winds: 1, other: 0.5 },
  hill: { rainfall: 3, fog: 3, flooding: 1, thunderstorm: 2, other: 1 },
};
const photo = (cat: EventCategory, i: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${CAT_COLOR[cat]}" stop-opacity=".55"/><stop offset="1" stop-color="#0B1830"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><text x="320" y="235" font-size="120" text-anchor="middle">${CAT_ICON[cat]}</text><text x="320" y="320" font-size="20" fill="#cfe" text-anchor="middle" font-family="sans-serif">photo ${i}</text></svg>`)}`;
const CORRO = [0, 0, 10, 17, 22, 25];
const textScore = (t: string) => { const up = t.replace(/[^A-Za-z]/g, ""); return Math.max(0, 10 - (t.length < 15 ? 4 : 0) - (up.length > 8 && up.replace(/[^A-Z]/g, "").length / up.length > 0.6 ? 3 : 0) - ((t.match(/#/g) || []).length >= 4 || (t.match(/https?:/g) || []).length > 1 ? 3 : 0)); };
const KEYS: [EventCategory, RegExp][] = [["flooding", /flood|waterlog|overflow|submerge|baadh|jalbharav|knee-deep/i], ["thunderstorm", /thunder|lightning|bijli|toofan/i], ["heatwave", /heat|scorch|loo |garmi|degrees/i], ["fog", /fog|mist|kohra|dhund|visibility/i], ["dust_storm", /dust|sand|aandhi|dhool/i], ["strong_winds", /wind|gale|gusty|tez hawa|uprooted/i], ["rainfall", /rain|downpour|drizzle|baarish|varsha/i]];
const classify = (t: string): [EventCategory, number] => { for (const [c, re] of KEYS) if (re.test(t)) return [c, 0.6 + Math.random() * 0.3]; return ["other", 0.3]; };

function generate(): Rep[] {
  const rnd = rng(7), out: Rep[] = [];
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const wcat = (tag: string): EventCategory => { const w = W[tag], tot = Object.values(w).reduce((a, b) => a + (b ?? 0), 0); let x = rnd() * tot; for (const [k, v] of Object.entries(w)) { x -= v ?? 0; if (x <= 0) return k as EventCategory; } return "rainfall"; };
  let n = 0;
  const make = (city: (typeof CITIES)[number], cat: EventCategory, tMs: number, src: string, cid: string, distinct: number, hasApi: boolean, fake: boolean): Rep => {
    n++;
    const text = fake ? pick(FAKE) : pick(TEXT[cat]).replace("{c}", city[0]);
    const media = !fake && rnd() < 0.4, reused = media && rnd() < 0.08;
    const allow = src === "api:imd";
    const bd = { sourceReliability: Math.round(25 * REL[src]), corroboration: CORRO[Math.min(5, distinct)], officialMatch: hasApi ? 25 : 8, media: media ? (reused ? 0 : 9) : 0, text: textScore(text) };
    const total = allow ? 95 : Math.min(100, Object.values(bd).reduce((a, b) => a + b, 0));
    const conf = rnd() < 0.05 ? 0.3 + rnd() * 0.19 : 0.55 + rnd() * 0.43;
    const reasons = allow ? ["Official IMD source on the allow-list"] : [`${distinct} distinct source${distinct === 1 ? "" : "s"} in this cluster`, hasApi ? "Official observation nearby supports this claim" : "No official data available nearby (neutral)", media ? (reused ? "Photo was already used in an earlier, unrelated report" : "Photo attached; no EXIF to verify") : "No media attached", ...(bd.text < 10 ? ["Text looks like spam or is too short"] : [])];
    const ok = total >= 75 && conf >= 0.5;
    const ing = new Date(tMs + 7000).toISOString();
    return {
      reportId: `rep-${String(n).padStart(4, "0")}-${Math.floor(rnd() * 1e6).toString(16)}`, sourceType: (src.split(":")[0] as Rep["sourceType"]), sourceId: src, rawText: text, claimedCategory: cat, city: city[0], state: city[1],
      location: { type: "Point", coordinates: [city[3] + (rnd() - 0.5) * 0.28, city[2] + (rnd() - 0.5) * 0.28] }, locationPrecision: "city",
      media: media ? [{ url: photo(cat, n), type: "image" }] : [], clusterId: cid, clusterSize: distinct, trustScore: total, trustBreakdown: allow ? undefined : bd, trustReasons: reasons,
      category: conf < 0.5 ? "other" : cat, categoryConfidence: +conf.toFixed(2), lowConfidence: conf < 0.5, verificationStatus: ok ? "verified" : "needs_review", verifiedBy: ok ? "system" : null,
      submittedAt: new Date(tMs).toISOString(), ingestedAt: ing, stageTimes: { dedupAt: new Date(tMs + 8000).toISOString(), trustAt: new Date(tMs + 9000).toISOString(), classifiedAt: new Date(tMs + 9500).toISOString() },
    };
  };
  const cluster = (cityName: string, cat: EventCategory, count: number, distinct: number, spanMin: number, endAgoMin: number, fakeRatio = 0) => {
    const city = CITIES.find((c) => c[0] === cityName)!, cid = `c-${cityName.slice(0, 4).toLowerCase()}-${n}`;
    const srcs = [...SRC].sort(() => rnd() - 0.5).slice(0, distinct), hasApi = srcs.some((s) => s.startsWith("api:"));
    const arr: Rep[] = [];
    for (let k = 0; k < count; k++) arr.push(make(city, cat, NOW - (endAgoMin + rnd() * spanMin) * MIN, k < distinct ? srcs[k] : pick(srcs), cid, distinct, hasApi, rnd() < fakeRatio));
    arr.forEach((r) => { r.clusterSize = count; });
    out.push(...arr);
  };
  // live hotspots (5+ distinct sources, recent)
  cluster("Wardha", "flooding", 9, 6, 50, 4); cluster("Mumbai", "rainfall", 12, 7, 55, 3); cluster("Guwahati", "flooding", 8, 5, 52, 8); cluster("Chennai", "thunderstorm", 7, 5, 48, 12);
  // older events
  for (let i = 0; i < 22; i++) { const c = pick(CITIES); const d = 3 + Math.floor(rnd() * 6); cluster(c[0], wcat(c[4]), d + 2, Math.min(d, 6), 90, 180 + rnd() * 29 * 24 * 60, 0.05); }
  // singles
  for (let i = 0; i < 170; i++) { const c = pick(CITIES), t = NOW - Math.pow(rnd(), 2.2) * 30 * DAY, fake = rnd() < 0.12; out.push(make(c, wcat(c[4]), t, pick(SRC.filter((s) => !s.startsWith("api:imd"))), `c-s${i}`, 1, false, fake)); }
  out.sort((a, b) => +new Date(b.submittedAt) - +new Date(a.submittedAt));
  // moderator history
  const old = out.filter((r) => r.verificationStatus === "needs_review" && NOW - +new Date(r.submittedAt) > 6 * HR);
  old.filter((r) => (r.trustScore ?? 0) >= 50).slice(0, 12).forEach((r) => { r.verificationStatus = "verified"; r.verifiedBy = "moderator"; AUDIT[r.reportId] = [{ reportId: r.reportId, actor: "moderator@skywatch.local", fromStatus: "needs_review", toStatus: "verified", comment: "Matches the IMD bulletin for that day", at: new Date(+new Date(r.submittedAt) + 2 * HR).toISOString() }]; });
  old.filter((r) => (r.trustScore ?? 0) < 30).slice(0, 8).forEach((r) => { r.verificationStatus = "rejected"; r.verifiedBy = "moderator"; AUDIT[r.reportId] = [{ reportId: r.reportId, actor: "moderator@skywatch.local", fromStatus: "needs_review", toStatus: "rejected", comment: "Spam pattern, no matching official data", at: new Date(+new Date(r.submittedAt) + 3 * HR).toISOString() }]; });
  return out;
}
const AUDIT: Record<string, AuditLogEntry[]> = {};
const DB: Rep[] = generate();
const listeners = new Set<(r: Rep) => void>();
const emit = (r: Rep) => listeners.forEach((f) => f(r));
const SOURCES: SourceRow[] = SRC.map((id) => { const rs = DB.filter((r) => r.sourceId === id); return { id, type: id.split(":")[0], reliability: REL[id], reportCount: rs.length, approved: rs.filter((r) => r.verifiedBy === "moderator" && r.verificationStatus === "verified").length, rejected: rs.filter((r) => r.verificationStatus === "rejected").length, blocked: false, allowListed: id === "api:imd" }; });
export const CONFIG_DEFAULTS: Record<string, unknown> = { "trust.autoVerifyThreshold": 75, "classification.minConfidence": 0.5, "dedup.maxDistanceKm": 10, "dedup.windowMinutes": 120, "dedup.similarityThreshold": 0.6, "hotspot.minSources": 5, "hotspot.radiusKm": 10, "hotspot.windowMinutes": 60, "collectors.social.intervalSec": 60, "collectors.api.intervalSec": 900, "collectors.hashtags": ["#IMD", "#rainfall", "#flood", "#heatwave", "#thunderstorm", "#fog", "#duststorm"] };
let CONFIG: ConfigEntry[] = Object.entries(CONFIG_DEFAULTS).map(([key, value]) => ({ key, value, updatedBy: "admin@skywatch.local", updatedAt: new Date(NOW - 3 * DAY).toISOString() }));
const USERS: AdminUser[] = [
  { _id: "u1", email: "admin@skywatch.local", role: "admin", active: true, createdAt: new Date(NOW - 40 * DAY).toISOString(), lastLoginAt: new Date(NOW - 2 * HR).toISOString() },
  { _id: "u2", email: "moderator@skywatch.local", role: "moderator", active: true, createdAt: new Date(NOW - 30 * DAY).toISOString(), lastLoginAt: new Date(NOW - 26 * HR).toISOString() },
  { _id: "u3", email: "intern@skywatch.local", role: "moderator", active: false, createdAt: new Date(NOW - 12 * DAY).toISOString() },
];

// ---------- public API ----------
type RepList = { items: Rep[]; page: number; limit: number; total: number };
export function listReports(f: ReportFilters = {}): Promise<RepList> {
  return live(() => api.fetchReports(f) as unknown as Promise<RepList>, () => {
    let r = DB.filter((x) => x.verificationStatus !== "rejected");
    if (f.status === "verified") r = r.filter((x) => x.verificationStatus === "verified");
    if (f.status === "unverified") r = r.filter((x) => x.verificationStatus !== "verified");
    if (f.category?.length) r = r.filter((x) => f.category!.includes((x.category ?? "other") as EventCategory));
    if (f.state) r = r.filter((x) => x.state === f.state);
    if (f.city) r = r.filter((x) => x.city === f.city);
    if (f.dateFrom) r = r.filter((x) => +new Date(x.submittedAt) >= +new Date(f.dateFrom!));
    if (f.dateTo) r = r.filter((x) => +new Date(x.submittedAt) <= +new Date(f.dateTo!));
    const limit = f.limit ?? 500;
    return { items: r.slice(0, limit), page: 1, limit, total: r.length };
  });
}
export const getReport = (id: string): Promise<Rep> => live(() => api.fetchReport(id) as Promise<Rep>, () => { const r = DB.find((x) => x.reportId === id && x.verificationStatus !== "rejected"); if (!r) throw new Error("Report not found"); return { ...r }; });

export async function uploadMedia(files: File[]): Promise<string[]> {
  if (demo) return files.map((f) => URL.createObjectURL(f));
  const urls: string[] = [];
  for (const f of files) { try { const fd = new FormData(); fd.append("file", f); const res = await fetch(`${API_URL}/api/media`, { method: "POST", body: fd }); if (res.ok) urls.push((await res.json()).url); } catch { /* backend has no media endpoint yet */ } }
  return urls;
}
export function submit(body: Parameters<typeof api.submitReport>[0], media: string[]): Promise<{ reportId: string; status: string }> {
  return live(() => api.submitReport({ ...body, media: media.map((url) => ({ url, type: url.endsWith(".mp4") ? "video" as const : "image" as const })) }), () => {
    const c = CITIES.find((x) => x[0].toLowerCase() === (body.city ?? "").toLowerCase());
    const lat = body.latitude ?? c?.[2], lng = body.longitude ?? c?.[3], now = new Date().toISOString();
    const r: Rep = { reportId: crypto.randomUUID(), sourceType: "citizen", sourceId: "citizen:anonymous", rawText: body.rawText, claimedCategory: body.claimedCategory, city: body.city, state: body.state ?? c?.[1], location: lat !== undefined && lng !== undefined ? { type: "Point", coordinates: [lng, lat] } : undefined, locationPrecision: body.latitude !== undefined ? "exact" : c ? "city" : "unknown", media: media.map((url) => ({ url, type: "image" as const })), verificationStatus: "pending", verifiedBy: null, submittedAt: now, ingestedAt: now };
    DB.unshift(r);
    setTimeout(() => {
      const [cat, conf] = body.claimedCategory ? [body.claimedCategory, 0.85] as [EventCategory, number] : classify(body.rawText);
      const bd = { sourceReliability: 10, corroboration: 0, officialMatch: 8, media: r.media.length ? 9 : 0, text: textScore(body.rawText) + (r.location ? 0 : 0) };
      const total = Object.values(bd).reduce((a, b) => a + b, 0), t = Date.now();
      Object.assign(r, { category: cat, categoryConfidence: +conf.toFixed(2), lowConfidence: conf < 0.5, trustScore: total, trustBreakdown: bd, clusterId: `c-new-${r.reportId.slice(0, 4)}`, clusterSize: 1, trustReasons: ["1 distinct source in this cluster", "No official data available nearby (neutral)", r.media.length ? "Photo attached; no EXIF to verify" : "No media attached"], verificationStatus: total >= 75 && conf >= 0.5 ? "verified" : "needs_review", verifiedBy: total >= 75 ? "system" : null, stageTimes: { dedupAt: new Date(t - 2500).toISOString(), trustAt: new Date(t - 1200).toISOString(), classifiedAt: new Date(t).toISOString() } });
      emit(r);
    }, 4200);
    return { reportId: r.reportId, status: "pending" };
  });
}

export function useLiveFeed(onReport: (r: Partial<Rep>) => void) {
  const d = useDemo();
  const [status, setStatus] = useState<"live" | "reconnecting" | "demo">(d ? "demo" : "reconnecting");
  const cb = useRef(onReport);
  useEffect(() => { cb.current = onReport; });
  useEffect(() => {
    if (d) {
      setStatus("demo");
      const fn = (r: Rep) => cb.current(r); listeners.add(fn);
      const t = setInterval(() => { const c = CITIES[Math.floor(Math.random() * CITIES.length)], cats = Object.keys(W[c[4]]) as EventCategory[], cat = cats[Math.floor(Math.random() * cats.length)]; const txt = TEXT[cat][Math.floor(Math.random() * TEXT[cat].length)].replace("{c}", c[0]); const now = new Date().toISOString(); const src = SRC[Math.floor(Math.random() * 6) + 2]; const sc = 45 + Math.floor(Math.random() * 50); const r: Rep = { reportId: crypto.randomUUID(), sourceType: src.split(":")[0] as Rep["sourceType"], sourceId: src, rawText: txt, claimedCategory: cat, category: cat, categoryConfidence: 0.8, city: c[0], state: c[1], location: { type: "Point", coordinates: [c[3] + (Math.random() - 0.5) * 0.2, c[2] + (Math.random() - 0.5) * 0.2] }, locationPrecision: "city", media: [], trustScore: sc, trustBreakdown: { sourceReliability: 12, corroboration: 10, officialMatch: 8, media: 0, text: 10 }, trustReasons: ["2 distinct sources in this cluster"], verificationStatus: sc >= 75 ? "verified" : "needs_review", verifiedBy: sc >= 75 ? "system" : null, submittedAt: now, ingestedAt: now }; DB.unshift(r); emit(r); }, 7000);
      return () => { clearInterval(t); listeners.delete(fn); };
    }
    setStatus("reconnecting");
    const es = new EventSource(`${API_URL}/api/stream`);
    es.onopen = () => setStatus("live"); es.onerror = () => setStatus("reconnecting");
    es.addEventListener("report", (e) => { try { cb.current(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ } });
    return () => es.close();
  }, [d]);
  return status;
}

// ---------- admin API ----------
export const queue = (f: { category?: string; state?: string } = {}): Promise<{ items: Rep[] }> => live(() => api.fetchQueue(f) as Promise<{ items: Rep[] }>, () => ({ items: DB.filter((r) => r.verificationStatus === "needs_review" && (!f.category || r.category === f.category) && (!f.state || r.state === f.state)).sort((a, b) => (a.trustScore ?? 0) - (b.trustScore ?? 0)).slice(0, 100) }));
export const detail = (id: string): Promise<Detail> => live(async () => {
  try { const d = await raw<Detail>(`/api/admin/reports/${id}`); if (d?.report) return { report: d.report, cluster: d.cluster ?? [], source: d.source ?? null }; } catch { /* older backend without this endpoint */ }
  const r = ((await api.fetchQueue()).items.find((x) => x.reportId === id) as Rep | undefined) ?? (await api.fetchReport(id) as Rep);
  return { report: r, cluster: [], source: null };
}, () => { const r = DB.find((x) => x.reportId === id); if (!r) throw new Error("Report not found"); return { report: r, cluster: DB.filter((x) => x.clusterId === r.clusterId && x.reportId !== id).slice(0, 8), source: SOURCES.find((s) => s.id === r.sourceId) ?? null }; });
export const verify = (id: string, action: "approve" | "reject", comment?: string, override?: EventCategory): Promise<unknown> => live(() => api.verifyReport(id, action, comment, override), () => {
  const r = DB.find((x) => x.reportId === id); if (!r) throw new Error("Report not found");
  if (action === "reject" && !comment) throw new Error("A comment is required when rejecting a report");
  const from = r.verificationStatus; r.verificationStatus = action === "approve" ? "verified" : "rejected"; r.verifiedBy = "moderator"; if (override) r.category = override;
  (AUDIT[id] ||= []).unshift({ reportId: id, actor: "demo@skywatch.local", fromStatus: from, toStatus: r.verificationStatus, comment, at: new Date().toISOString() });
  return r;
});
export const audit = (id: string) => live(() => api.fetchAudit(id), () => ({ items: AUDIT[id] ?? [] }));
export const getConfig = () => live(() => api.fetchConfig(), () => ({ items: CONFIG }));
export const setConfig = (key: string, value: unknown) => live(() => api.updateConfig(key, value), () => { CONFIG = CONFIG.some((c) => c.key === key) ? CONFIG.map((c) => (c.key === key ? { ...c, value, updatedBy: "demo@skywatch.local", updatedAt: new Date().toISOString() } : c)) : [...CONFIG, { key, value, updatedAt: new Date().toISOString() }]; return CONFIG.find((c) => c.key === key)!; });
export const getUsers = () => live(() => api.fetchUsers(), () => ({ items: USERS }));
export const addUser = (email: string, pw: string, role: "moderator" | "admin") => live(() => api.createUser(email, pw, role), () => { USERS.push({ _id: `u${USERS.length + 1}`, email, role, active: true, createdAt: new Date().toISOString() }); return { id: email, email, role }; });
export const editUser = (id: string, body: { active?: boolean; role?: "moderator" | "admin" }) => live(() => api.patchUser(id, body), () => { const u = USERS.find((x) => x._id === id)!; Object.assign(u, body); return u; });
export const getSources = (): Promise<{ items: SourceRow[] }> => live(() => raw("/api/admin/sources"), () => ({ items: SOURCES }));
export const editSource = (id: string, body: Partial<SourceRow>) => live(() => raw<SourceRow>(`/api/admin/sources/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }), () => { const s = SOURCES.find((x) => x.id === id)!; Object.assign(s, body); return s; });
export const getHealth = (): Promise<Health> => live(() => raw("/api/admin/pipeline"), () => {
  const r = () => Array.from({ length: 24 }, () => 6 + Math.round(Math.random() * 28));
  return { queued: Math.round(Math.random() * 40), dlq: 3, stages: [["Dedup", 4], ["Trust score", 7], ["Classification", 2], ["Storage", 1]].map(([name, lag]) => ({ name: name as string, lag: Math.round(Math.random() * (lag as number)), rate: 80 + Math.round(Math.random() * 40), spark: r() })) };
});

// ---------- official alerts and conditions (sample data until your backend adds them) ----------
export type Severity = "extreme" | "severe" | "moderate" | "low";
export interface WxAlert { id: string; title: string; severity: Severity; type: string; states: string[]; region: string; issuedAt: string; expiresAt: string; description: string; source: string; lat: number; lng: number }
export const SEV_COLOR: Record<Severity, string> = { extreme: "#EF4444", severe: "#F97316", moderate: "#EAB308", low: "#22C55E" };
const ALERT_SEED: [string, Severity, string, string[], string, number, number, string, number, number][] = [
  ["Heavy to Very Heavy Rainfall Warning for Assam and Meghalaya", "severe", "Heavy Rainfall", ["Assam", "Meghalaya"], "Assam, Meghalaya", 0, 24, "Heavy to very heavy rainfall with thunderstorm and lightning is expected over Assam and Meghalaya for the next 24 hours. Avoid low-lying areas.", 26.2, 91.7],
  ["Cyclone Alert: Bay of Bengal System Moving Towards Odisha Coast", "extreme", "Cyclone", ["Odisha", "Andhra Pradesh"], "Odisha, Andhra Pradesh", 0, 48, "A deep depression over the Bay of Bengal is expected to intensify into a cyclonic storm within 24 hours. Fishermen should not venture into the sea.", 19.8, 85.8],
  ["Flood Warning Issued for Bihar: River Ganga Breaching Banks", "severe", "Flood", ["Bihar"], "Bihar, Patna", 0, 24, "The Ganga river has exceeded danger levels at Patna and several adjoining districts. Move to higher ground if advised.", 25.6, 85.1],
  ["Thunderstorm and Lightning Alert for Uttar Pradesh", "moderate", "Thunderstorm", ["Uttar Pradesh"], "Uttar Pradesh", 0, 6, "Isolated thunderstorms with lightning and gusty winds expected over eastern Uttar Pradesh.", 26.8, 80.9],
  ["Dense Fog Advisory for Punjab and Haryana", "low", "Fog", ["Punjab", "Haryana"], "Punjab, Haryana", 2, 14, "Dense fog may reduce visibility to under 200 metres during early morning hours.", 30.7, 76.8],
  ["Strong Wind Warning along the Kerala Coast", "moderate", "Strong Winds", ["Kerala"], "Kerala coast", 1, 20, "Squally winds of 45 to 55 km/h are likely along the coast. Small boats should stay ashore.", 9.9, 76.3],
  ["Heatwave Conditions over Rajasthan", "moderate", "Heatwave", ["Rajasthan"], "Rajasthan", 3, 30, "Maximum temperatures are likely to stay 4 to 5 degrees above normal over west Rajasthan.", 26.9, 75.8],
  ["Landslide Risk in Uttarakhand Hills", "severe", "Landslide", ["Uttarakhand"], "Uttarakhand", 1, 36, "Continuous rain over the past two days has raised landslide risk on the Char Dham routes.", 30.3, 78.0],
];
export const listAlerts = async (): Promise<{ items: WxAlert[]; sample: boolean }> => {
  if (!demo) { try { const r = await raw<{ items: WxAlert[] }>("/api/alerts"); return { items: r.items, sample: false }; } catch { /* endpoint not built yet */ } }
  return { sample: true, items: ALERT_SEED.map((a, i) => ({ id: `a-${i}`, title: a[0], severity: a[1], type: a[2], states: a[3], region: a[4], issuedAt: new Date(NOW - a[5] * HR).toISOString(), expiresAt: new Date(NOW + a[6] * HR).toISOString(), description: a[7], source: "Official bulletin (sample)", lat: a[8], lng: a[9] })) };
};

export interface Conditions { city: string; state: string; temp: number; feels: number; desc: string; high: number; low: number; humidity: number; wind: number; windDir: string; visibility: number; pressure: number; cloud: number; uv: number; aqi: number; rain: boolean; sample: boolean }
export const getConditions = async (city: string): Promise<Conditions> => {
  const c = CITIES.find((x) => x[0] === city) ?? CITIES[1];
  if (!demo) { try { const r = await raw<Conditions & { configured?: boolean }>(`/api/weather?city=${encodeURIComponent(city)}`); if (r.configured !== false && typeof r.temp === "number") return { ...r, sample: false }; } catch { /* backend has no weather key yet: use the sample below */ } }
  const r = rng(Math.floor(c[2] * 100 + c[3]) + new Date().getDate()), tag = c[4], hr = new Date().getHours();
  const hiBase = 36 - (c[2] - 8) * 0.28 - (tag === "hill" ? 9 : 0) - (tag === "coast" ? 3 : 0), high = Math.round(hiBase + r() * 2), low = Math.round(high - 8 + r() * 2 - (tag === "coast" ? 3 : 0));
  const temp = Math.round(low + (high - low) * Math.max(0, Math.sin(((hr - 6) / 14) * Math.PI)));
  const rain = (tag === "coast" || tag === "east") && r() > 0.4, hum = Math.round((tag === "coast" || tag === "east" ? 68 : 38) + r() * 20);
  return { city: c[0], state: c[1], temp, feels: Math.round(temp + (hum - 40) / 12), desc: rain ? "Light rain" : r() > 0.6 ? "Partly cloudy" : "Clear sky", high, low, humidity: hum, wind: +(1 + r() * 7).toFixed(1), windDir: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.floor(r() * 8)], visibility: +(rain ? 4 + r() * 3 : 8 + r() * 2).toFixed(1), pressure: Math.round(1006 + r() * 12), cloud: rain ? 70 + Math.round(r() * 25) : Math.round(r() * 40), uv: Math.max(0, Math.round((tag === "hill" ? 5 : 7) * Math.sin(((hr - 6) / 12) * Math.PI))), aqi: Math.round(c[4] === "north" ? 150 + r() * 120 : 45 + r() * 60), rain, sample: true };
};
