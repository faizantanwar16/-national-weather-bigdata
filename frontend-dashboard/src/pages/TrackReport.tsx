import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getReport } from "../api/gateway";
import { ApiDown, CatBadge, Gauge, Notice, Signals, Skeleton, StatusBadge, catOf, place, timeAgo, useLoad } from "../ui";

export function TrackReport() {
  const { reportId } = useParams();
  const nav = useNavigate();
  const [id, setId] = useState(reportId ?? "");
  const go = (e: FormEvent) => { e.preventDefault(); if (id.trim()) nav(`/track/${id.trim()}`); };
  return (
    <div className="narrow" style={{ display: "grid", gap: 16 }}>
      <form className="card" onSubmit={go} style={{ display: "flex", gap: 10, alignItems: "end" }}><label className="f" style={{ flex: 1 }}>Tracking ID<input value={id} onChange={(e) => setId(e.target.value)} placeholder="Paste the ID you were given" /></label><button className="btn pri">Track</button></form>
      {reportId && <Result id={reportId} />}
    </div>
  );
}

function Result({ id }: { id: string }) {
  const r = useLoad(() => getReport(id), [id], 3000);
  if (r.loading && !r.data) return <Skeleton h={260} />;
  if (r.error && !r.data) return <div className="card">{/not found/i.test(r.error) ? <Notice title="No public report with that ID" body="Check the ID. Reports that moderators rejected are not shown publicly." /> : <ApiDown message={r.error} onRetry={r.reload} />}</div>;
  const d = r.data!, pending = d.verificationStatus === "pending";
  const st = d.stageTimes ?? {};
  const stages: [string, boolean, string | undefined][] = [["Received", true, d.ingestedAt], ["Grouped", !!d.clusterId || !!st.dedupAt, st.dedupAt], ["Scored", d.trustScore !== undefined, st.trustAt], ["Classified", d.categoryConfidence !== undefined || !!st.classifiedAt, st.classifiedAt], ["Decision", !pending, st.classifiedAt]];
  const firstOpen = stages.findIndex((s) => !s[1]);
  return (
    <section className="card" style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><h2>{place(d)}</h2><span className="sub">Submitted {timeAgo(d.submittedAt)}</span></div><div style={{ display: "flex", gap: 8, alignItems: "start" }}><StatusBadge status={d.verificationStatus} />{!pending && <CatBadge cat={catOf(d)} />}</div></div>
      <div className="pipe" aria-label="Processing stages">{stages.map(([n, ok, t], i) => <div key={n} className={ok ? "done" : i === firstOpen && pending ? "now" : ""}>{ok ? "✓ " : ""}{n}<small>{ok && t ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : i === firstOpen && pending ? "working…" : ""}</small></div>)}</div>
      <p>{d.rawText}</p>
      {d.trustScore !== undefined && <div style={{ display: "flex", gap: 16, alignItems: "center" }}><Gauge score={d.trustScore} /><div className="sub">{d.verificationStatus === "verified" ? "Verified. It’s on the live map now." : d.verificationStatus === "needs_review" ? "A moderator will look at this report. It will show publicly once approved." : "Processing."}</div></div>}
      <Signals data={d.trustBreakdown} />
      {d.trustReasons && d.trustReasons.length > 0 && <ul className="reasons">{d.trustReasons.map((t) => <li key={t}>{t}</li>)}</ul>}
    </section>
  );
}
