import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import { divIcon } from "leaflet";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CAT_COLOR, CAT_ICON, STATES, distKm, listReports, useDemo, useLiveFeed } from "../api/gateway";
import type { Rep } from "../api/gateway";
import { CATEGORY_LABELS, EVENT_CATEGORIES } from "../api/types";
import type { EventCategory } from "../api/types";
import { CatBadge, Gauge, Signals, StatusBadge, catOf, place, timeAgo, useLoad } from "../ui";
import { useToast } from "../context";
import { MAP_TILES, MAP_ATTRIBUTION, MAP_SUBDOMAINS } from "../config/map";


const HOUR = 3600000, DAY = 86400000;
type Preset = "24h" | "7d" | "30d" | "custom";
const presetRange = (p: Preset) => ({ from: new Date(Date.now() - (p === "24h" ? DAY : p === "7d" ? 7 * DAY : 30 * DAY)).toISOString(), to: "" });
const grid = [...Array.from({ length: 8 }, (_, i) => 8 + i * 4).map((lat) => [[lat, 66], [lat, 100]] as [number, number][]), ...Array.from({ length: 9 }, (_, i) => 68 + i * 4).map((lng) => [[6, lng], [36, lng]] as [number, number][])];
const hotIcon = divIcon({ className: "hot", html: "<i></i><i></i>", iconSize: [0, 0] });

function Fly({ to }: { to: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (to) map.flyTo(to, Math.max(map.getZoom(), 7), { duration: 0.8 }); }, [to, map]);
  return null;
}

export function Dashboard() {
  const toast = useToast();
  const demo = useDemo();
  const [preset, setPreset] = useState<Preset>("7d");
  const [range, setRange] = useState(() => presetRange("7d"));
  const [cats, setCats] = useState<EventCategory[]>([]);
  const [scope, setScope] = useState<"verified" | "unverified" | "all">("verified");
  const [stateF, setStateF] = useState("");
  const [near, setNear] = useState<{ lat: number; lng: number; km: number } | null>(null);
  const [heat, setHeat] = useState(false);
  const [sel, setSel] = useState<Rep | null>(null);
  const [hov, setHov] = useState<Rep | null>(null);
  const [tab, setTab] = useState<"cat" | "time" | "state">("cat");
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ticker, setTicker] = useState<Rep[]>([]);
  const [fly, setFly] = useState<[number, number] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const filters = { category: cats.length ? cats : undefined, status: scope === "all" ? undefined : scope, state: stateF || undefined, dateFrom: range.from || undefined, dateTo: range.to ? `${range.to}T23:59:59` : undefined, limit: 500 };
  const q = useLoad(() => listReports(filters), [JSON.stringify(filters), demo], 30000);
  const feed = useLiveFeed((r) => { if (r.rawText) setTicker((t) => [r as Rep, ...t].slice(0, 8)); q.reload(); });

  // Keep "now" fresh without calling Date.now() during render
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const items = useMemo(() => (q.data?.items ?? []).filter((r) => r.location && (!near || distKm([near.lat, near.lng], [r.location.coordinates[1], r.location.coordinates[0]]) <= near.km)), [q.data, near]);
  const start = range.from ? +new Date(range.from) : items.length ? Math.min(...items.map((r) => +new Date(r.submittedAt))) : now - 7 * DAY;
  const end = now;
  const visible = useMemo(() => (cursor === null ? items : items.filter((r) => +new Date(r.submittedAt) <= cursor)), [items, cursor]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setCursor((c) => { const n = (c ?? start) + (end - start) / 90; if (n >= end) { setPlaying(false); return null; } return n; }), 110);
    return () => clearInterval(t);
  }, [playing, start, end]);
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === "Escape" && setSel(null); window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, []);

  const counts = useMemo(() => { const m: Partial<Record<EventCategory, number>> = {}; visible.forEach((r) => { const c = catOf(r); m[c] = (m[c] ?? 0) + 1; }); return m; }, [visible]);
  const states = useMemo(() => { const m = new Map<string, number>(); visible.forEach((r) => r.state && m.set(r.state, (m.get(r.state) ?? 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8); }, [visible]);
  const timeline = useMemo(() => {
    const span = end - start, step = span <= 48 * HOUR ? HOUR : DAY, n = Math.min(60, Math.ceil(span / step)), b = Array.from({ length: n + 1 }, (_, i) => ({ t: start + i * step, verified: 0, review: 0 }));
    visible.forEach((r) => { const i = Math.min(n, Math.max(0, Math.floor((+new Date(r.submittedAt) - start) / step))); if (r.verificationStatus === "verified") b[i].verified++; else b[i].review++; });
    return b.map((x) => ({ ...x, label: step === HOUR ? new Date(x.t).getHours() + ":00" : new Date(x.t).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) }));
  }, [visible, start, end]);
  const hotspots = useMemo(() => {
    const g = new Map<string, Rep[]>(); visible.forEach((r) => r.clusterId && g.set(r.clusterId, [...(g.get(r.clusterId) ?? []), r]));
    return [...g.values()].map((rs) => ({ rs, id: rs[0].clusterId!, sources: new Set(rs.map((x) => x.sourceId)).size, cat: catOf(rs[0]), lat: rs.reduce((a, x) => a + x.location!.coordinates[1], 0) / rs.length, lng: rs.reduce((a, x) => a + x.location!.coordinates[0], 0) / rs.length })).filter((h) => h.sources >= 5).sort((a, b) => b.sources - a.sources);
  }, [visible]);

  const verifiedPct = visible.length ? Math.round((visible.filter((r) => r.verificationStatus === "verified").length / visible.length) * 100) : 0;
  const toggleCat = (c: EventCategory) => setCats((v) => (v.includes(c) ? v.filter((x) => x !== c) : [...v, c]));
  const pick = (p: Preset) => { setPreset(p); if (p !== "custom") setRange(presetRange(p)); };
  const select = (r: Rep) => { setSel(r); setFly([r.location!.coordinates[1], r.location!.coordinates[0]]); };
  const locate = () => {
    if (near) return setNear(null);
    const use = (lat: number, lng: number) => { setNear({ lat, lng, km: 150 }); setFly([lat, lng]); };
    navigator.geolocation?.getCurrentPosition((p) => use(p.coords.latitude, p.coords.longitude), () => { toast("Location permission denied, so Nagpur is used as the centre.", true); use(21.1458, 79.0882); });
  };
  const reset = () => { setCats([]); setStateF(""); setScope("verified"); setNear(null); setCursor(null); setPlaying(false); pick("7d"); };
  const cluster = sel ? visible.filter((r) => r.clusterId && r.clusterId === sel.clusterId && r.reportId !== sel.reportId).slice(0, 6) : [];
  const stateOptions = [...new Set([...STATES, ...states.map((s) => s[0])])].sort();

  return (
    <div className="stage">
      <div className="mapbox">
        <MapContainer center={[22.6, 80]} zoom={5} minZoom={4} preferCanvas style={{ height: "100%" }} zoomControl={false} worldCopyJump>
          {MAP_TILES && <TileLayer attribution={MAP_ATTRIBUTION} url={MAP_TILES} subdomains={MAP_SUBDOMAINS} />}
          {grid.map((l, i) => <Polyline key={i} positions={l} pathOptions={{ color: "#5BA2FF", weight: 1, opacity: 0.1 }} interactive={false} />)}
          <Fly to={fly} />
          {near && <Circle center={[near.lat, near.lng]} radius={near.km * 1000} pathOptions={{ color: "#5BA2FF", weight: 1.5, dashArray: "6 6", fillOpacity: 0.05 }} interactive={false} />}
          {heat && visible.map((r) => <CircleMarker key={`h${r.reportId}`} center={[r.location!.coordinates[1], r.location!.coordinates[0]]} radius={30} pathOptions={{ stroke: false, fillColor: CAT_COLOR[catOf(r)], fillOpacity: 0.11 }} interactive={false} />)}
          {visible.map((r) => {
            const ok = r.verificationStatus === "verified", c = CAT_COLOR[catOf(r)], on = sel?.reportId === r.reportId;
            return <CircleMarker key={r.reportId} center={[r.location!.coordinates[1], r.location!.coordinates[0]]} radius={on ? 12 : 5 + (r.trustScore ?? 40) / 25} pathOptions={{ color: on ? "#fff" : c, weight: on ? 3 : ok ? 1.2 : 1.6, dashArray: ok ? undefined : "3 3", fillColor: c, fillOpacity: ok ? 0.88 : 0.22 }} eventHandlers={{ click: () => select(r), mouseover: () => setHov(r), mouseout: () => setHov(null) }} />;
          })}
          {hotspots.map((h) => <Marker key={h.id} position={[h.lat, h.lng]} icon={hotIcon} interactive={false} />)}
        </MapContainer>
      </div>

      <section className="glass filters" aria-label="Filters">
        <div className="frow">
          <div className="seg" role="group" aria-label="Date range">{(["24h", "7d", "30d", "custom"] as Preset[]).map((p) => <button key={p} aria-pressed={preset === p} onClick={() => pick(p)}>{p === "custom" ? "Custom" : p === "24h" ? "24 hours" : p === "7d" ? "7 days" : "30 days"}</button>)}</div>
          {preset === "custom" && <><input type="date" aria-label="From" value={range.from.slice(0, 10)} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value ? `${e.target.value}T00:00:00` : "" }))} /><input type="date" aria-label="To" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></>}
          <select aria-label="State" value={stateF} onChange={(e) => setStateF(e.target.value)}><option value="">All states</option>{stateOptions.map((s) => <option key={s}>{s}</option>)}</select>
          <div className="seg" role="group" aria-label="Status">{([["verified", "Verified"], ["unverified", "Unverified"], ["all", "Both"]] as const).map(([k, l]) => <button key={k} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>)}</div>
          <button className="btn sm" aria-pressed={!!near} onClick={locate} style={near ? { borderColor: "var(--blue)" } : undefined}>{near ? "Near me: on" : "Near me"}</button>
          {near && <label className="mono" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="range" min={20} max={500} step={10} value={near.km} onChange={(e) => setNear({ ...near, km: +e.target.value })} style={{ width: 110 }} />{near.km} km</label>}
          <button className="btn sm" aria-pressed={heat} onClick={() => setHeat((h) => !h)} style={heat ? { borderColor: "var(--amber)" } : undefined}>Heat layer</button>
          <button className="btn sm" onClick={reset}>Reset</button>
        </div>
        <div className="frow">{EVENT_CATEGORIES.map((c) => <button key={c} className="chip" aria-pressed={cats.includes(c)} onClick={() => toggleCat(c)} style={{ "--c": CAT_COLOR[c] } as CSSProperties}><span aria-hidden>{CAT_ICON[c]}</span>{CATEGORY_LABELS[c]}</button>)}</div>
      </section>

      {hotspots[0] && (
        <div className="glass alert" role="alert">
          <span style={{ fontSize: 24 }}>{CAT_ICON[hotspots[0].cat]}</span>
          <div style={{ flex: 1 }}><b>Hotspot: {hotspots[0].sources} sources report {CATEGORY_LABELS[hotspots[0].cat].toLowerCase()} near {hotspots[0].rs[0].city}</b><div className="sub">{hotspots.length} active hotspot{hotspots.length > 1 ? "s" : ""} in view</div></div>
          <button className="btn sm" onClick={() => setFly([hotspots[0].lat, hotspots[0].lng])}>Show</button>
        </div>
      )}

      {hov && !sel && <div className="glass hov"><b>{CAT_ICON[catOf(hov)]} {place(hov)}</b> · trust {hov.trustScore ?? "–"} · {timeAgo(hov.submittedAt)}</div>}

      <aside className="glass side" aria-label="Summary">
        <div className="kpis">
          <div className="kpi"><b>{visible.length.toLocaleString("en-IN")}</b><span>Events in view</span></div>
          <div className="kpi"><b>{verifiedPct}%</b><span>Verified</span></div>
          <div className="kpi"><b>{visible.filter((r) => r.verificationStatus !== "verified").length}</b><span>Awaiting review</span></div>
          <div className="kpi"><b style={{ color: hotspots.length ? "var(--rose)" : undefined }}>{hotspots.length}</b><span>Hotspots</span></div>
        </div>
        <div className="tabs" role="tablist">{([["cat", "Event types"], ["time", "Over time"], ["state", "States"]] as const).map(([k, l]) => <button key={k} role="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
        {q.error && !q.data ? <p className="err">{q.error}</p> : visible.length === 0 && !q.loading ? (
          <div className="state"><h3>No events match</h3><p>Widen the date range or clear a filter.</p><button className="btn" onClick={reset}>Reset filters</button></div>
        ) : tab === "cat" ? (
          <div>{EVENT_CATEGORIES.map((c) => <button key={c} className="hbar" aria-pressed={cats.includes(c)} onClick={() => toggleCat(c)} style={{ "--c": CAT_COLOR[c] } as CSSProperties}><span>{CAT_ICON[c]} {CATEGORY_LABELS[c]}</span><div className="t"><i style={{ width: `${((counts[c] ?? 0) / Math.max(1, ...Object.values(counts))) * 100}%` }} /></div><span className="mono">{counts[c] ?? 0}</span></button>)}</div>
        ) : tab === "time" ? (
          <div style={{ height: 230 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={timeline}>
            <CartesianGrid stroke="rgba(140,170,210,.12)" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8CA2BE" }} tickLine={false} axisLine={false} minTickGap={24} /><YAxis allowDecimals={false} width={26} tick={{ fontSize: 11, fill: "#8CA2BE" }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: "#13243B", border: "1px solid rgba(140,170,210,.2)", borderRadius: 10 }} />
            <Area type="monotone" dataKey="verified" name="Verified" stackId="a" stroke="#3DD6C6" fill="#3DD6C6" fillOpacity={0.28} /><Area type="monotone" dataKey="review" name="Unverified" stackId="a" stroke="#FFB84D" fill="#FFB84D" fillOpacity={0.2} />
          </AreaChart></ResponsiveContainer></div>
        ) : (
          <div>{states.map(([s, n]) => <button key={s} className="hbar" aria-pressed={stateF === s} onClick={() => setStateF(stateF === s ? "" : s)} style={{ "--c": "var(--blue)" } as CSSProperties}><span>{s}</span><div className="t"><i style={{ width: `${(n / states[0][1]) * 100}%` }} /></div><span className="mono">{n}</span></button>)}</div>
        )}
        <Link to="/report" className="btn pri" style={{ justifyContent: "center" }}>Report what you see</Link>
      </aside>

      <section className="glass dock" aria-label="Live feed and time-lapse">
        <div className="frow" style={{ flexWrap: "nowrap" }}>
          <span className="pill" style={{ "--c": feed === "live" ? "var(--teal)" : feed === "demo" ? "var(--blue)" : "var(--amber)" } as CSSProperties}><i className={`dot${feed === "reconnecting" ? " off" : ""}`} />{feed === "live" ? "Live" : feed === "demo" ? "Simulated live" : "Reconnecting"}</span>
          <div className="tick">{ticker.length === 0 ? <span className="sub">New reports will appear here as they arrive.</span> : ticker.slice(0, 5).map((r) => <button key={r.reportId} className="tk" onClick={() => r.location && select(r)}><span aria-hidden>{CAT_ICON[catOf(r)]}</span><span>{r.city}: {r.rawText}</span></button>)}</div>
        </div>
        <div className="scrub">
          <button className="btn sm" onClick={() => { if (playing) setPlaying(false); else { if (cursor === null) setCursor(start); setPlaying(true); } }} aria-label={playing ? "Pause time-lapse" : "Play time-lapse"}>{playing ? "Pause" : "Time-lapse"}</button>
          <input type="range" aria-label="Time cursor" min={start} max={end} value={cursor ?? end} step={Math.max(1000, (end - start) / 300)} onChange={(e) => { setPlaying(false); setCursor(+e.target.value >= end - 2000 ? null : +e.target.value); }} />
          <span className="mono" style={{ minWidth: 118 }}>{cursor === null ? "Now" : new Date(cursor).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </section>

      {sel && (
        <aside className="glass drawer" role="dialog" aria-label="Report details">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><div><h2>{place(sel)}</h2><span className="sub">{timeAgo(sel.submittedAt)} · {sel.sourceId ?? sel.sourceType}</span></div><button className="btn sm" onClick={() => setSel(null)}>Close</button></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><StatusBadge status={sel.verificationStatus} /><CatBadge cat={catOf(sel)} />{sel.categoryConfidence !== undefined && <span className="badge" style={{ "--c": "var(--mute)" } as CSSProperties}>{Math.round(sel.categoryConfidence * 100)}% sure</span>}</div>
          {sel.media.length > 0 && <div className="media">{sel.media.map((m, i) => m.type === "video" ? <video key={i} src={m.url} controls /> : <img key={i} src={m.url} alt={`Report media ${i + 1}`} />)}</div>}
          <p>{sel.rawText}</p>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}><Gauge score={sel.trustScore} /><div className="sub">How much we trust this report, out of 100. {sel.verifiedBy === "moderator" ? "A moderator made the final call." : sel.verificationStatus === "verified" ? "It passed the automatic threshold." : "A moderator is yet to decide."}</div></div>
          <Signals data={sel.trustBreakdown} />
          {sel.trustReasons && sel.trustReasons.length > 0 && <ul className="reasons">{sel.trustReasons.map((t) => <li key={t}>{t}</li>)}</ul>}
          {cluster.length > 0 && <div><h3 style={{ fontSize: 15, marginBottom: 6 }}>Same event, {cluster.length} more report{cluster.length > 1 ? "s" : ""}</h3>{cluster.map((r) => <button key={r.reportId} className="hbar" style={{ gridTemplateColumns: "1fr auto" } as CSSProperties} onClick={() => select(r)}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.rawText}</span><span className="mono">{r.trustScore}</span></button>)}</div>}
          <Link className="btn" to={`/track/${sel.reportId}`}>Open tracking page</Link>
        </aside>
      )}
    </div>
  );
}