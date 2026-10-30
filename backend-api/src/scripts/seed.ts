// npm run seed            creates users, default settings, official sources and demo data (skips demo data if reports exist)
// npm run seed -- --reset wipes reports, clusters, sources, logs and alerts first, then regenerates the demo data
// The demo reports go through the REAL pipeline (dedup, trust score, classification), so scores and clusters are genuine.
import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { randomUUID } from "crypto";
import { connectDB } from "../config/db";
import { Report, EventCategory } from "../models/Report";
import { Cluster } from "../models/Cluster";
import { Source } from "../models/Source";
import { User } from "../models/User";
import { Alert } from "../models/Alert";
import { FailedReport } from "../models/FailedReport";
import { VerificationLog } from "../models/VerificationLog";
import { ensureDefaults } from "../services/settings";
import { CITIES } from "../services/gazetteer";
import { geohashEncode } from "../services/geo";
import { processReport } from "../services/pipeline";
import { ensureOfficialSources } from "../services/weatherCollector";
import { UPLOAD_DIR } from "../routes/media";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

const MIN = 60_000, HR = 3600_000, DAY = 86_400_000;
let seed = 11;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];

const TAG: Record<string, string> = { Wardha: "central", Nagpur: "central", Mumbai: "coast", Pune: "central", Delhi: "north", Chandigarh: "north", Jaipur: "north", Lucknow: "north", Patna: "east", Kolkata: "east", Bhubaneswar: "east", Guwahati: "east", Imphal: "east", Ranchi: "east", Raipur: "central", Bhopal: "central", Indore: "central", Ahmedabad: "coast", Surat: "coast", Hyderabad: "central", Visakhapatnam: "coast", Chennai: "coast", Bengaluru: "central", Mangaluru: "coast", Kochi: "coast", Thiruvananthapuram: "coast", Panaji: "coast", Dehradun: "hill", Shimla: "hill", Srinagar: "hill" };
const W: Record<string, Partial<Record<EventCategory, number>>> = {
  coast: { rainfall: 5, flooding: 3, thunderstorm: 2, strong_winds: 2, other: 0.5 }, east: { rainfall: 4, flooding: 3, thunderstorm: 3, strong_winds: 1, fog: 1, other: 0.5 },
  central: { rainfall: 3, thunderstorm: 3, heatwave: 2, dust_storm: 1, strong_winds: 1, flooding: 1.5, other: 0.5 }, north: { fog: 3, heatwave: 2, dust_storm: 2, rainfall: 2, thunderstorm: 1.5, strong_winds: 1, other: 0.5 },
  hill: { rainfall: 3, fog: 3, flooding: 1, thunderstorm: 2, other: 1 },
};
const TEXT: Record<EventCategory, string[]> = {
  rainfall: ["Heavy rain since morning in {c}, roads are slippery", "Steady downpour over {c}, schools sending kids home early", "{c} mein baarish ruk nahi rahi, sadkon par paani", "Rain turning heavy near {c} railway station"],
  flooding: ["Water logging on the main road in {c}, vehicles stuck", "River overflowing near the bridge in {c}, road submerged", "{c} mein baadh jaisi halat, ghar mein paani ghus gaya", "Low-lying colonies in {c} are knee-deep in water"],
  thunderstorm: ["Loud thunder and lightning over {c} for the last hour", "Lightning struck a transformer near {c}, power cut", "{c} mein bijli kadak rahi hai, tez toofan"],
  heatwave: ["45 degrees and no relief in {c}, loo chal rahi hai", "Scorching heat in {c}, roads empty at noon", "{c} mein garmi ne record tod diya"],
  fog: ["Dense fog in {c}, low visibility on the highway", "{c} mein kohra bahut ghana hai, flights delayed", "Morning mist so thick near {c} that headlights barely help"],
  dust_storm: ["Dust storm rolling in over the highway near {c}", "{c} mein aandhi, sab kuch dhool se dhaka", "Sky turned orange with dust around {c}"],
  strong_winds: ["Trees uprooted by strong winds in {c}", "Gusty winds tearing hoardings across {c}", "{c} mein tez hawa, bijli ke taar toote"],
  other: ["Hailstones the size of marbles in {c}", "Strange sudden cold snap in {c} this evening"],
};
const FAKE = ["WORLD ENDING!!! CYCLONE HITTING NOW SHARE SHARE SHARE", "flood", "rain #rain #rain #flood #news #breaking https://x.co/a1 https://x.co/b2", "ALL CITIES WILL DROWN TONIGHT FORWARD TO EVERYONE"];
const REL: Record<string, number> = { "api:imd": 0.98, "api:openweathermap": 0.95, "news:thehindu": 0.78, "news:timesofindia": 0.74, "news:ndtv": 0.72, "social:@weather_watch_in": 0.62, "social:@storm_chasers_in": 0.55, "social:@rain_alerts": 0.5, "social:@city_updates": 0.45, "citizen:anonymous": 0.4 };
const POOL = Object.keys(REL).filter((s) => s !== "api:imd");
const OBS: Record<EventCategory, object> = {
  rainfall: { precipMm: 6, tempC: 26, visibilityM: 4000, windKmh: 22, cloudPct: 92 }, flooding: { precipMm: 14, tempC: 25, visibilityM: 3000, windKmh: 25, cloudPct: 96 },
  thunderstorm: { precipMm: 9, tempC: 27, visibilityM: 3500, windKmh: 38, cloudPct: 95 }, heatwave: { precipMm: 0, tempC: 43, visibilityM: 6000, windKmh: 12, cloudPct: 5 },
  fog: { precipMm: 0, tempC: 9, visibilityM: 300, windKmh: 4, cloudPct: 60 }, dust_storm: { precipMm: 0, tempC: 36, visibilityM: 1500, windKmh: 58, cloudPct: 20 },
  strong_winds: { precipMm: 0, tempC: 30, visibilityM: 8000, windKmh: 52, cloudPct: 40 }, other: { precipMm: 0, tempC: 24, visibilityM: 9000, windKmh: 10, cloudPct: 30 },
};

interface Spec { city: (typeof CITIES)[number]; cat: EventCategory; t: number; src: string; text: string; exact: boolean; claimed: boolean; media?: boolean; obs?: object }
const specs: Spec[] = [];
const wcat = (tag: string): EventCategory => { const w = W[tag], tot = Object.values(w).reduce((a, b) => a + (b ?? 0), 0); let x = rnd() * tot; for (const [k, v] of Object.entries(w)) { x -= v ?? 0; if (x <= 0) return k as EventCategory; } return "rainfall"; };
const cityOf = (n: string) => CITIES.find((c) => c[0] === n)!;

function event(cityName: string, cat: EventCategory, count: number, distinct: number, spanMin: number, endAgoMin: number, fakeRatio = 0) {
  const city = cityOf(cityName), srcs = [...POOL].sort(() => rnd() - 0.5).slice(0, distinct), templates = [...TEXT[cat]].sort(() => rnd() - 0.5).slice(0, 3);
  const withApi = distinct >= 5 || rnd() < 0.5;
  if (withApi && !srcs.includes("api:openweathermap")) srcs[0] = "api:openweathermap";
  for (let k = 0; k < count; k++) {
    const src = k < distinct ? srcs[k] : pick(srcs), t = Date.now() - (endAgoMin + rnd() * spanMin) * MIN;
    if (src.startsWith("api:")) { specs.push({ city, cat, t, src, text: `Observation near ${city[0]}: ${cat.replace("_", " ")} conditions reported`, exact: false, claimed: true, obs: OBS[cat] }); continue; }
    const fake = rnd() < fakeRatio;
    specs.push({ city, cat, t, src, text: fake ? pick(FAKE) : pick(templates).replace("{c}", city[0]), exact: rnd() < 0.9, claimed: !fake && rnd() < 0.75, media: !fake && rnd() < 0.45 });
  }
}

const ICON: Record<EventCategory, string> = { rainfall: "🌧️", thunderstorm: "⛈️", flooding: "🌊", heatwave: "🔥", fog: "🌫️", dust_storm: "🌪️", strong_winds: "💨", other: "❔" };
const COLOR: Record<EventCategory, string> = { rainfall: "#38BDF8", thunderstorm: "#A78BFA", flooding: "#3B82F6", heatwave: "#F87171", fog: "#94A3B8", dust_storm: "#D4A24C", strong_winds: "#34D399", other: "#CBD5E1" };
// one placeholder picture per event type; every demo report gets its own unique hash so photos count as "new"
function writeSampleMedia() {
  for (const c of Object.keys(ICON) as EventCategory[]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${COLOR[c]}" stop-opacity=".6"/><stop offset="1" stop-color="#0B1830"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><text x="320" y="230" font-size="120" text-anchor="middle">${ICON[c]}</text><text x="320" y="320" font-size="20" fill="#cfe" text-anchor="middle" font-family="sans-serif">sample photo</text></svg>`;
    fs.writeFileSync(path.join(UPLOAD_DIR, `sample-${c}.svg`), svg);
  }
}

async function main() {
  await connectDB();
  const reset = process.argv.includes("--reset");
  if (reset) {
    await Promise.all([Report.deleteMany({}), Cluster.deleteMany({}), Source.deleteMany({}), VerificationLog.deleteMany({}), FailedReport.deleteMany({}), Alert.deleteMany({})]);
    console.log("[seed] cleared reports, clusters, sources, logs and alerts");
  }

  // sign-in accounts
  const accounts = [
    { email: (process.env.SEED_ADMIN_EMAIL || "admin@nwa.local").toLowerCase(), password: process.env.SEED_ADMIN_PASSWORD || "Admin@12345", role: "admin" as const },
    { email: (process.env.SEED_MODERATOR_EMAIL || "moderator@nwa.local").toLowerCase(), password: process.env.SEED_MODERATOR_PASSWORD || "Moderator@12345", role: "moderator" as const },
  ];
  for (const a of accounts) {
    if (await User.exists({ email: a.email })) { console.log(`[seed] user exists: ${a.email}`); continue; }
    await User.create({ email: a.email, passwordHash: await bcrypt.hash(a.password, 10), role: a.role });
    console.log(`[seed] created ${a.role}: ${a.email}  password: ${a.password}`);
  }

  await ensureDefaults();
  await ensureOfficialSources();
  for (const [id, reliability] of Object.entries(REL)) await Source.updateOne({ sourceId: id }, { $setOnInsert: { sourceId: id, type: id.split(":")[0], reliability, allowListed: id === "api:imd", blocked: false, reportCount: 0, approvedCount: 0, rejectedCount: 0 } }, { upsert: true });

  if (await Report.exists({})) { console.log("[seed] reports already exist, skipping demo data (use: npm run seed -- --reset)"); return; }

  // sample bulletins so the Alerts page has content before an official feed is connected
  const bulletins: [string, "extreme" | "severe" | "moderate" | "low", string, string[], string, number, string, number, number][] = [
    ["Cyclone Alert: Bay of Bengal System Moving Towards Odisha Coast", "extreme", "Cyclone", ["Odisha", "Andhra Pradesh"], "Odisha, Andhra Pradesh", 48, "A deep depression over the Bay of Bengal is expected to intensify into a cyclonic storm within 24 hours.", 19.8, 85.8],
    ["Heavy to Very Heavy Rainfall Warning for Assam and Meghalaya", "severe", "Heavy Rainfall", ["Assam", "Meghalaya"], "Assam, Meghalaya", 24, "Heavy to very heavy rainfall with thunderstorm and lightning is expected for the next 24 hours.", 26.2, 91.7],
    ["Flood Warning Issued for Bihar: River Ganga Breaching Banks", "severe", "Flood", ["Bihar"], "Bihar, Patna", 24, "The Ganga river has exceeded danger levels at Patna and several adjoining districts.", 25.6, 85.1],
    ["Thunderstorm and Lightning Alert for Uttar Pradesh", "moderate", "Thunderstorm", ["Uttar Pradesh"], "Uttar Pradesh", 8, "Isolated thunderstorms with lightning and gusty winds expected over eastern Uttar Pradesh.", 26.8, 80.9],
    ["Dense Fog Advisory for Punjab and Haryana", "low", "Fog", ["Punjab", "Haryana"], "Punjab, Haryana", 14, "Dense fog may reduce visibility to under 200 metres during early morning hours.", 30.7, 76.8],
  ];
  for (const [i, b] of bulletins.entries()) await Alert.updateOne({ alertId: `seed-${i + 1}` }, { $setOnInsert: { alertId: `seed-${i + 1}`, title: b[0], severity: b[1], type: b[2], states: b[3], region: b[4], issuedAt: new Date(), expiresAt: new Date(Date.now() + b[5] * HR), description: b[6], source: "Sample bulletin (seed data)", lat: b[7], lng: b[8], createdBy: "seed" } }, { upsert: true });

  // ---- demo reports: recent hotspots, older events, and one-off reports
  event("Wardha", "flooding", 10, 7, 30, 2); event("Mumbai", "rainfall", 13, 8, 32, 2); event("Guwahati", "flooding", 9, 6, 30, 4); event("Chennai", "thunderstorm", 9, 7, 28, 6);
  for (let i = 0; i < 22; i++) { const c = pick(CITIES.filter((x) => TAG[x[0]])); const d = 3 + Math.floor(rnd() * 5); event(c[0], wcat(TAG[c[0]]), d + 2, Math.min(d, 6), 90, 180 + rnd() * 29 * 24 * 60, 0.05); }
  for (let i = 0; i < 170; i++) { const c = pick(CITIES.filter((x) => TAG[x[0]])), fake = rnd() < 0.12, cat = wcat(TAG[c[0]]); specs.push({ city: c, cat, t: Date.now() - Math.pow(rnd(), 2.2) * 30 * DAY, src: pick(POOL.filter((s) => !s.startsWith("api"))), text: fake ? pick(FAKE) : pick(TEXT[cat]).replace("{c}", c[0]), exact: rnd() < 0.8, claimed: !fake && rnd() < 0.75, media: !fake && rnd() < 0.3 }); }
  specs.sort((a, b) => a.t - b.t);

  writeSampleMedia();
  const base = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`;
  console.log(`[seed] processing ${specs.length} demo reports through the pipeline...`);
  for (const s of specs) {
    const reportId = randomUUID(), lat = s.city[2] + (rnd() - 0.5) * (s.exact ? 0.06 : 0.02), lng = s.city[3] + (rnd() - 0.5) * (s.exact ? 0.06 : 0.02);
    await Report.create({
      reportId, sourceType: s.src.split(":")[0], sourceId: s.src, rawText: s.text, language: /\b(mein|ghana|baarish|aandhi)\b/i.test(s.text) ? "hi" : "en", hashtags: s.text.match(/#\w+/g) ?? [],
      submittedAt: new Date(s.t), ingestedAt: new Date(s.t + 7000), location: { type: "Point", coordinates: [lng, lat] }, locationPrecision: s.exact ? "exact" : "city",
      city: s.city[0], state: s.city[1], geohash: geohashEncode(lat, lng), claimedCategory: s.claimed ? s.cat : undefined, observation: s.obs,
      media: s.media ? [{ url: `${base}/uploads/sample-${s.cat}.svg`, type: "image", phash: randomBytes(8).toString("hex") }] : [], verificationStatus: "pending",
    });
    await processReport(reportId);
  }

  // ---- moderator history: approve the best of the older review items, reject the worst
  const old = await Report.find({ verificationStatus: "needs_review", submittedAt: { $lt: new Date(Date.now() - 6 * HR) } }).sort({ trustScore: -1 });
  const decide = async (r: (typeof old)[number], action: "approve" | "reject", comment: string) => {
    const to = action === "approve" ? "verified" : "rejected";
    await Report.updateOne({ reportId: r.reportId }, { verificationStatus: to, verifiedBy: "moderator" });
    await VerificationLog.create({ reportId: r.reportId, actor: "moderator@nwa.local", fromStatus: "needs_review", toStatus: to, comment, at: new Date(r.submittedAt.getTime() + 2 * HR) });
    await Source.updateOne({ sourceId: r.sourceId }, { $inc: action === "approve" ? { approvedCount: 1 } : { rejectedCount: 1 } });
  };
  for (const r of old.filter((x) => (x.trustScore ?? 0) >= 45).slice(0, 12)) await decide(r, "approve", "Matches the official bulletin for that day");
  for (const r of old.slice(-8)) await decide(r, "reject", "Spam pattern, no matching official data");

  const counts = await Report.aggregate([{ $group: { _id: "$verificationStatus", n: { $sum: 1 } } }]);
  console.log("[seed] done:", Object.fromEntries(counts.map((c) => [c._id, c.n])), `clusters: ${await Cluster.countDocuments()}`);
}

main().catch((e) => { console.error("[seed] failed", e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
