import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip as MapTip } from "react-leaflet";
import { AlertTriangle, ChevronDown, Clock, LayoutGrid, List, Map as MapIcon, MapPin, Search } from "lucide-react";
import { SEV_COLOR, listAlerts, listReports } from "../api/gateway";
import type { Severity, WxAlert } from "../api/gateway";
import { CATEGORY_LABELS } from "../api/types";
import { ApiDown, Skeleton, catOf, useLoad } from "../ui";

const TILES = import.meta.env.VITE_NO_TILES === "1" ? null : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const SEVS: Severity[] = ["extreme", "severe", "moderate", "low"];
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

export function Alerts() {
  const off = useLoad(listAlerts, [], 60000);
  const reps = useLoad(() => listReports({ dateFrom: new Date(Date.now() - 3 * 86400000).toISOString(), limit: 500 }), [], 60000);
  const [q, setQ] = useState(""); const [state, setState] = useState(""); const [type, setType] = useState(""); const [sev, setSev] = useState<Severity | "all">("all");
  const [view, setView] = useState<"grid" | "list" | "map">("grid"); const [open, setOpen] = useState<string | null>(null);

  const community = useMemo<WxAlert[]>(() => {
    const g = new Map<string, NonNullable<typeof reps.data>["items"]>();
    (reps.data?.items ?? []).forEach((r) => r.clusterId && r.location && g.set(r.clusterId, [...(g.get(r.clusterId) ?? []), r]));
    return [...g.entries()].map(([id, rs]) => ({ id, rs, n: new Set(rs.map((x) => x.sourceId)).size })).filter((x) => x.n >= 5).map(({ id, rs, n }) => {
      const r0 = rs[0], cat = CATEGORY_LABELS[catOf(r0)];
      return { id: `h-${id}`, title: `Community hotspot: ${cat.toLowerCase()} near ${r0.city}`, severity: n >= 7 ? "severe" : "moderate", type: cat, states: [r0.state ?? ""], region: `${r0.city}, ${r0.state}`, issuedAt: rs.reduce((a, x) => (x.submittedAt < a ? x.submittedAt : a), r0.submittedAt), expiresAt: new Date(Date.now() + 3 * 3600000).toISOString(), description: `${n} distinct sources and ${rs.length} reports describe the same event within a few kilometres. Detected automatically by the hotspot job.`, source: "Community hotspot", lat: r0.location!.coordinates[1], lng: r0.location!.coordinates[0] } as WxAlert;
    });
  }, [reps.data]);
  const all = useMemo(() => [...(off.data?.items ?? []), ...community].sort((a, b) => SEVS.indexOf(a.severity) - SEVS.indexOf(b.severity)), [off.data, community]);
  const list = all.filter((a) => (sev === "all" || a.severity === sev) && (!state || a.states.includes(state)) && (!type || a.type === type) && (!q || `${a.title} ${a.region} ${a.type}`.toLowerCase().includes(q.toLowerCase())));
  const statesOpt = [...new Set(all.flatMap((a) => a.states))].filter(Boolean).sort(), typesOpt = [...new Set(all.map((a) => a.type))].sort();
  const ext = all.filter((a) => a.severity === "extreme");
  const Card = ({ a }: { a: WxAlert }) => {
    const soon = +new Date(a.expiresAt) - Date.now() < 8 * 3600000, on = open === a.id;
    return (
      <article className="acard" style={{ "--c": SEV_COLOR[a.severity] } as CSSProperties} onClick={() => setOpen(on ? null : a.id)}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span className="sevb">{a.severity[0].toUpperCase() + a.severity.slice(1)}</span><span className="typeb">{a.type}</span>{soon && <span className="typeb" style={{ color: "#EAB308", background: "rgba(234,179,8,.14)" }}>Expiring soon</span>}<ChevronDown size={18} style={{ marginLeft: "auto", color: "var(--mute)", transform: on ? "rotate(180deg)" : undefined, transition: ".2s" }} /></div>
        <h3>{a.title}</h3>
        <div className="meta"><span><MapPin size={14} />{a.region}</span><span><Clock size={14} />{when(a.issuedAt)}</span></div>
        <div className="meta"><span><AlertTriangle size={14} />Expires {when(a.expiresAt)}</span><span>{a.source}</span></div>
        <p style={on ? undefined : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{a.description}</p>
      </article>
    );
  };
  const AMap = ({ h }: { h: number }) => (
    <div className="amap" style={{ height: h }}><MapContainer center={[22.5, 80]} zoom={4} minZoom={3} style={{ height: "100%" }} scrollWheelZoom={false}>{TILES && <TileLayer url={TILES} subdomains="abcd" attribution="&copy; OpenStreetMap, &copy; CARTO" />}{list.map((a) => <CircleMarker key={a.id} center={[a.lat, a.lng]} radius={9} pathOptions={{ color: "#fff", weight: 1.5, fillColor: SEV_COLOR[a.severity], fillOpacity: 0.95 }} eventHandlers={{ click: () => setOpen(a.id) }}><MapTip>{a.title}</MapTip></CircleMarker>)}</MapContainer></div>
  );
  return (
    <>
      <div className="pagehead"><h1>Alerts</h1><p>Official warnings and community hotspots.{off.data?.sample && " Official bulletins shown are sample data."}</p></div>
      {off.loading && !off.data ? <Skeleton h={300} /> : off.error && !off.data ? <div className="card"><ApiDown message={off.error} onRetry={off.reload} /></div> : (
        <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.8fr) minmax(0,1fr)", alignItems: "start" }}>
          <div className="grid" style={{ gap: 16 }}>
            <div className="card" style={{ display: "grid", gap: 12, padding: 18 }}>
              <div className="srch" style={{ maxWidth: "none" }}><Search size={17} /><input placeholder="Search alerts, states, events..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search alerts" /></div>
              <div className="grid g2" style={{ gap: 12 }}><select value={state} onChange={(e) => setState(e.target.value)} aria-label="State"><option value="">All States</option>{statesOpt.map((s) => <option key={s}>{s}</option>)}</select><select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All Types</option>{typesOpt.map((s) => <option key={s}>{s}</option>)}</select></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="fchip" aria-pressed={sev === "all"} onClick={() => setSev("all")} style={{ "--c": "#8195B1" } as CSSProperties}><i />All</button>{SEVS.map((s) => <button key={s} className="fchip" aria-pressed={sev === s} onClick={() => setSev(s)} style={{ "--c": SEV_COLOR[s] } as CSSProperties}><i />{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><b style={{ fontSize: 16 }}>{list.length} alert{list.length === 1 ? "" : "s"}</b><div className="seg2" role="group" aria-label="View">{([["grid", LayoutGrid], ["list", List], ["map", MapIcon]] as const).map(([k, I]) => <button key={k} aria-pressed={view === k} aria-label={`${k} view`} onClick={() => setView(k)}><I size={17} /></button>)}</div></div>
            {list.length === 0 ? <div className="state"><h3>No alerts match</h3><p>Try another severity, state or type.</p></div> : view === "map" ? <AMap h={520} /> : <div className="grid" style={{ gridTemplateColumns: view === "grid" ? "repeat(auto-fit,minmax(300px,1fr))" : "1fr", gap: 14 }}>{list.map((a) => <Card key={a.id} a={a} />)}</div>}
          </div>
          <div className="grid" style={{ gap: 16 }}>
            <section className="panel"><h3>Risk summary</h3><div className="brief" style={{ "--c": ext.length ? SEV_COLOR.extreme : SEV_COLOR.low, display: "block", padding: 16 } as CSSProperties}><div className="eyebrow" style={{ color: "#60A5FA" }}>National risk assessment</div><p style={{ fontSize: 15.5, marginTop: 6 }}>{ext.length ? `Extreme alerts are active across ${[...new Set(ext.flatMap((a) => a.states))].join(", ")}. Take immediate precautions.` : "No extreme alerts right now. Keep an eye on severe warnings."}</p></div><p className="sub" style={{ marginTop: 10 }}>Written by rules from the live alert list. It is not a forecast.</p></section>
            <section className="panel"><h3>Alert map</h3><div className="legend" style={{ marginBottom: 10 }}>{SEVS.map((s) => <span key={s}><i style={{ background: SEV_COLOR[s] }} />{s[0].toUpperCase() + s.slice(1)}</span>)}</div><AMap h={300} /></section>
          </div>
        </div>
      )}
    </>
  );
}
