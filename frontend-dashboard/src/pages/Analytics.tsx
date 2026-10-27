import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Area, AreaChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CAT_COLOR, listReports } from "../api/gateway";
import { CATEGORY_LABELS } from "../api/types";
import type { EventCategory } from "../api/types";
import { ApiDown, Skeleton, catOf, useLoad } from "../ui";

const tip = { contentStyle: { background: "#101D35", border: "1px solid rgba(120,150,200,.25)", borderRadius: 10, color: "#E6EEF9" }, itemStyle: { color: "#E6EEF9" } };
const ax = { tick: { fontSize: 11, fill: "#8195B1" }, tickLine: false, axisLine: false } as const;

export function Analytics() {
  const [days, setDays] = useState(30);
  const d = useLoad(() => listReports({ dateFrom: new Date(Date.now() - days * 86400000).toISOString(), limit: 500 }), [days], 60000);
  const items = useMemo(() => d.data?.items ?? [], [d.data]);
  const daily = useMemo(() => { const m = new Map<string, { day: string; verified: number; unverified: number }>(); for (let i = days - 1; i >= 0; i--) { const k = new Date(Date.now() - i * 86400000).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); m.set(k, { day: k, verified: 0, unverified: 0 }); } items.forEach((r) => { const e = m.get(new Date(r.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })); if (e) r.verificationStatus === "verified" ? e.verified++ : e.unverified++; }); return [...m.values()]; }, [items, days]);
  const cats = useMemo(() => { const m: Record<string, number> = {}; items.forEach((r) => (m[catOf(r)] = (m[catOf(r)] ?? 0) + 1)); return Object.entries(m).map(([k, v]) => ({ k: k as EventCategory, name: CATEGORY_LABELS[k as EventCategory], value: v })).sort((a, b) => b.value - a.value); }, [items]);
  const states = useMemo(() => { const m = new Map<string, number>(); items.forEach((r) => r.state && m.set(r.state, (m.get(r.state) ?? 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value })); }, [items]);
  const hist = useMemo(() => Array.from({ length: 10 }, (_, i) => ({ band: `${i * 10}-${i * 10 + 9}`, value: items.filter((r) => Math.min(99, r.trustScore ?? 0) >= i * 10 && Math.min(99, r.trustScore ?? 0) < i * 10 + 10).length })), [items]);
  const srcs = useMemo(() => { const m: Record<string, number> = {}; items.forEach((r) => (m[r.sourceType] = (m[r.sourceType] ?? 0) + 1)); return Object.entries(m).map(([name, value]) => ({ name, value })); }, [items]);
  const avg = items.length ? Math.round(items.reduce((a, r) => a + (r.trustScore ?? 0), 0) / items.length) : 0;
  const vr = items.length ? Math.round((items.filter((r) => r.verificationStatus === "verified").length / items.length) * 100) : 0;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}><div className="pagehead"><h1>Analytics</h1><p>How much is reported, how much we trust it, and where.</p></div><div className="seg">{[7, 14, 30].map((n) => <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>{n} days</button>)}</div></div>
      {d.loading && !d.data ? <Skeleton h={400} /> : d.error && !d.data ? <div className="card"><ApiDown message={d.error} onRetry={d.reload} /></div> : (<>
        <div className="kgrid"><div className="kcard"><span>Reports</span><b>{items.length}</b></div><div className="kcard"><span>Verification rate</span><b style={{ color: "var(--teal)" }}>{vr}%</b></div><div className="kcard"><span>Average trust score</span><b>{avg}</b></div><div className="kcard"><span>States reporting</span><b>{new Set(items.map((r) => r.state)).size}</b></div></div>
        <section className="card"><h2>Reports per day</h2><p className="sub">Verified and unverified</p><div style={{ height: 270 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={daily}><CartesianGrid stroke="rgba(120,150,200,.12)" vertical={false} /><XAxis dataKey="day" {...ax} minTickGap={22} /><YAxis allowDecimals={false} width={28} {...ax} /><Tooltip {...tip} /><Area type="monotone" dataKey="verified" name="Verified" stackId="a" stroke="#22C55E" fill="#22C55E" fillOpacity={0.25} /><Area type="monotone" dataKey="unverified" name="Unverified" stackId="a" stroke="#EAB308" fill="#EAB308" fillOpacity={0.2} /></AreaChart></ResponsiveContainer></div></section>
        <div className="grid g2e">
          <section className="card"><h2>Event types</h2><div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><div style={{ height: 230, width: 230 }}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={cats} dataKey="value" nameKey="name" innerRadius={58} outerRadius={96} paddingAngle={2} stroke="none">{cats.map((c) => <Cell key={c.k} fill={CAT_COLOR[c.k]} />)}</Pie><Tooltip {...tip} /></PieChart></ResponsiveContainer></div><div className="legend" style={{ flexDirection: "column", gap: 8 }}>{cats.map((c) => <span key={c.k}><i style={{ background: CAT_COLOR[c.k] }} />{c.name}: {c.value}</span>)}</div></div></section>
          <section className="card"><h2>Trust score spread</h2><p className="sub">Reports at or above 75 are verified automatically</p><div style={{ height: 230 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={hist}><CartesianGrid stroke="rgba(120,150,200,.12)" vertical={false} /><XAxis dataKey="band" {...ax} /><YAxis allowDecimals={false} width={28} {...ax} /><Tooltip {...tip} cursor={false} /><Bar dataKey="value" name="Reports" radius={5}>{hist.map((h, i) => <Cell key={h.band} fill={i >= 7 ? "#22C55E" : i >= 4 ? "#EAB308" : "#EF4444"} />)}</Bar></BarChart></ResponsiveContainer></div></section>
          <section className="card"><h2>Most affected states</h2><div style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%"><BarChart layout="vertical" data={states}><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={110} {...ax} /><Tooltip {...tip} cursor={false} /><Bar dataKey="value" name="Reports" fill="#3B82F6" radius={5} /></BarChart></ResponsiveContainer></div></section>
          <section className="card"><h2>Where reports come from</h2><div style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={srcs}><CartesianGrid stroke="rgba(120,150,200,.12)" vertical={false} /><XAxis dataKey="name" {...ax} /><YAxis allowDecimals={false} width={28} {...ax} /><Tooltip {...tip} cursor={false} /><Bar dataKey="value" name="Reports" fill="#22D3EE" radius={5} /></BarChart></ResponsiveContainer></div></section>
        </div>
      </>)}
    </>
  );
}
