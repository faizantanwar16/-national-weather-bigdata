import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Bike, Cloud, Droplets, Eye, Footprints, Gauge as GaugeIcon, Leaf, Lightbulb, Plane, Radio, Shield, Shirt, Sparkles, Thermometer, Wind } from "lucide-react";
import { CITIES, SEV_COLOR, getConditions, listAlerts, listReports } from "../api/gateway";
import type { Conditions, Rep } from "../api/gateway";
import { CATEGORY_LABELS } from "../api/types";
import { CAT_ICON } from "../api/gateway";
import { Mini, Skeleton, catOf, place, timeAgo, useLoad } from "../ui";

const clamp = (n: number) => Math.max(0, Math.min(10, n));
function impact(c: Conditions) {
  const comfy = 10 - Math.abs(c.temp - 24) / 3, rain = c.rain ? 3 : 0, air = c.aqi > 200 ? 4 : c.aqi > 150 ? 3 : c.aqi > 100 ? 1.5 : 0, wind = c.wind > 10 ? 3 : c.wind > 6 ? 1.5 : 0;
  return [["Travel", Plane, clamp(10 - rain * 0.8 - (c.visibility < 5 ? 2 : 0))], ["Outdoor", Leaf, clamp(comfy - rain - air * 0.6)], ["Running", Footprints, clamp(comfy - rain - air - (c.humidity > 80 ? 1 : 0))], ["Cycling", Bike, clamp(comfy - rain - wind - air * 0.5)]] as const;
}
const grade = (s: number): [string, string] => (s >= 8 ? ["Excellent", "#22C55E"] : s >= 6 ? ["Good", "#84CC16"] : s >= 4 ? ["Fair", "#EAB308"] : ["Poor", "#EF4444"]);
const wear = (c: Conditions) => [c.temp >= 32 ? "Light, breathable cotton with a hat" : c.temp >= 24 ? "Light casual wear" : c.temp >= 16 ? "Layers with a light jacket" : "Warm clothing", ...(c.rain ? ["Carry an umbrella or raincoat"] : []), ...(c.uv >= 7 ? ["Sunscreen and sunglasses"] : []), ...(c.aqi > 150 ? ["A mask outdoors"] : [])];
const tips = (c: Conditions) => [...(c.uv >= 8 ? ["UV is very high. Limit midday sun."] : []), ...(c.aqi > 150 ? [`Air quality is poor (AQI ${c.aqi}). Limit outdoor exercise.`] : []), ...(c.wind > 8 ? ["Windy conditions. Secure loose objects."] : []), ...(c.rain ? ["Rain expected. Allow extra travel time."] : [])];

export function Overview() {
  const [city, setCity] = useState("Nagpur");
  const alerts = useLoad(listAlerts, [], 60000);
  const cond = useLoad(() => getConditions(city), [city], 120000);
  const reps = useLoad(() => listReports({ dateFrom: new Date(Date.now() - 7 * 86400000).toISOString(), limit: 500 }), [], 30000);
  const items = useMemo(() => reps.data?.items ?? [], [reps.data]);
  const day = items.filter((r) => Date.now() - +new Date(r.submittedAt) < 86400000);
  const verified = day.filter((r) => r.verificationStatus === "verified").length;
  const states = useMemo(() => { const m = new Map<string, number>(); items.forEach((r) => r.state && m.set(r.state, (m.get(r.state) ?? 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 6); }, [items]);
  const hot = useMemo(() => { const g = new Map<string, Set<string | undefined>>(); items.forEach((r) => r.clusterId && g.set(r.clusterId, (g.get(r.clusterId) ?? new Set()).add(r.sourceId))); return [...g.values()].filter((s) => s.size >= 5).length; }, [items]);
  const al = alerts.data?.items ?? [], extreme = al.filter((a) => a.severity === "extreme").length;
  const top = al.find((a) => a.severity === "extreme") ?? al[0], tone = top ? SEV_COLOR[top.severity] : "#22C55E";
  const topCat = Object.entries(day.reduce<Record<string, number>>((m, r) => ((m[catOf(r)] = (m[catOf(r)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0];
  const c = cond.data;
  return (
    <>
      <div className="pagehead"><h1>Overview</h1><p>Official alerts, live conditions and community reports in one place.</p></div>
      {al.length > 0 && <div className="ticker" aria-label="Live alerts"><div className="tag"><Radio size={16} /> LIVE</div><div className="roll"><div>{[...al, ...al].map((a, i) => <span key={`${a.id}-${i}`}><i className="sevdot" style={{ "--c": SEV_COLOR[a.severity] } as CSSProperties} />{a.title}, {a.region}</span>)}</div></div></div>}
      <div className="brief" style={{ "--c": tone } as CSSProperties}>
        <div className="ico"><Shield size={22} /></div>
        <div style={{ flex: 1 }}><div className="eyebrow">Situation brief {extreme > 0 && <span className="badge" style={{ "--c": SEV_COLOR.extreme, marginLeft: 8 } as CSSProperties}>{extreme} Extreme</span>}</div>
          <p style={{ fontSize: 16, marginTop: 4 }}>{al.length ? `${al.length} active alerts${top ? `, led by "${top.title}"` : ""}. ` : "No active alerts. "}{hot} community hotspot{hot === 1 ? "" : "s"} and {verified} verified reports in the last 24 hours{topCat ? `, mostly ${CATEGORY_LABELS[topCat[0] as keyof typeof CATEGORY_LABELS].toLowerCase()}` : ""}.</p></div>
        <Link to="/alerts" className="btn" style={{ background: tone, borderColor: tone, color: "#fff" }}>View all</Link>
      </div>
      <div className="grid g2e">
        <div className="insight" style={{ background: "linear-gradient(135deg,#12163A,#0A1026)", borderColor: "rgba(139,92,246,.35)" }}><div className="eyebrow" style={{ color: "#A78BFA", display: "flex", gap: 8, alignItems: "center" }}><Sparkles size={16} /> Conditions summary</div>{c ? <p style={{ fontSize: 16 }}>Currently {c.temp}°C, {c.desc.toLowerCase()} in {c.city}. Today’s high {c.high}°C, low {c.low}°C.</p> : <Skeleton h={24} />}</div>
        <div className="insight" style={{ borderColor: "rgba(234,179,8,.3)" }}><div className="eyebrow" style={{ color: "#EAB308", display: "flex", gap: 8, alignItems: "center" }}><Lightbulb size={16} /> Smart insights</div>{c ? (tips(c).length ? tips(c) : ["Conditions look stable today. Enjoy your day!"]).map((t) => <p key={t}>→ {t}</p>) : <Skeleton h={24} />}</div>
      </div>
      <div className="grid g32" style={{ alignItems: "start" }}>
        <section className="cond">
          <div className="sunny" aria-hidden />
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><select aria-label="City" value={city} onChange={(e) => setCity(e.target.value)}>{CITIES.map((x) => <option key={x[0]}>{x[0]}</option>)}</select>{c?.sample && <span className="badge" style={{ "--c": "#fff" } as CSSProperties}>Sample data</span>}</div>
          {c ? <><div><div className="big">{c.temp}°C</div><div style={{ fontSize: 24, marginTop: 6 }}>{c.desc}</div></div>
            <div className="tiles">{([[Droplets, "Humidity", `${c.humidity}%`], [Wind, "Wind", `${c.wind} m/s ${c.windDir}`], [Eye, "Visibility", `${c.visibility} km`], [GaugeIcon, "Pressure", `${c.pressure} hPa`], [Thermometer, "Feels like", `${c.feels}°C`], [Cloud, "Cloud cover", `${c.cloud}%`]] as const).map(([I, l, v]) => <div key={l}><span><I size={15} />{l}</span><b>{v}</b></div>)}</div>
            <div style={{ opacity: 0.9, fontSize: 13.5 }}>UV index {c.uv} · Air quality index {c.aqi}</div></> : <Skeleton h={280} />}
        </section>
        <div className="grid" style={{ gap: 16 }}>
          <section className="panel"><h3>Weather impact score</h3>{c ? impact(c).map(([n, I, s]) => { const [g, col] = grade(s); return <div className="imp" key={n} style={{ "--c": col } as CSSProperties}><I size={18} color="var(--mute)" /><span>{n}</span><div className="t"><i style={{ width: `${s * 10}%` }} /></div><b>{g}</b></div>; }) : <Skeleton h={150} />}</section>
          <section className="panel"><h3><Shirt size={18} color="var(--cyan)" /> What to wear</h3>{c ? wear(c).map((w) => <p key={w} style={{ color: "var(--mute)", margin: "6px 0" }}>• {w}</p>) : <Skeleton h={60} />}</section>
        </div>
      </div>
      <div className="kgrid">
        <div className="kcard"><span>Reports in 24 hours</span><b>{day.length}</b></div>
        <div className="kcard"><span>Verified</span><b style={{ color: "var(--teal)" }}>{day.length ? Math.round((verified / day.length) * 100) : 0}%</b></div>
        <div className="kcard"><span>Awaiting review</span><b style={{ color: "var(--amber)" }}>{day.filter((r) => r.verificationStatus !== "verified").length}</b></div>
        <div className="kcard"><span>Active hotspots</span><b style={{ color: hot ? "var(--rose)" : undefined }}>{hot}</b></div>
      </div>
      <div className="grid g2e">
        <section className="panel"><h3>Latest verified events</h3>{reps.loading && !reps.data ? <Skeleton h={220} /> : items.filter((r) => r.verificationStatus === "verified").slice(0, 6).map((r: Rep) => <div className="row2" key={r.reportId}><Mini score={r.trustScore} /><div style={{ flex: 1, minWidth: 0 }}><b>{CAT_ICON[catOf(r)]} {place(r)}</b><p>{r.rawText}</p></div><span className="sub">{timeAgo(r.submittedAt)}</span></div>)}<Link to="/events" className="btn sm" style={{ marginTop: 10 }}>All events</Link></section>
        <section className="panel"><h3>Most affected states, 7 days</h3>{states.map(([s, n]) => <div className="imp" key={s} style={{ "--c": "var(--blue)", gridTemplateColumns: "130px 1fr 36px" } as CSSProperties}><span>{s}</span><div className="t"><i style={{ width: `${(n / states[0][1]) * 100}%` }} /></div><b style={{ color: "var(--ink)" }}>{n}</b></div>)}<Link to="/map" className="btn sm">Open live map</Link></section>
      </div>
    </>
  );
}
