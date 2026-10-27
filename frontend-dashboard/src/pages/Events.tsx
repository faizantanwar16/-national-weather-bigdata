import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CAT_ICON, STATES, listReports } from "../api/gateway";
import type { Rep } from "../api/gateway";
import { CATEGORY_LABELS, EVENT_CATEGORIES } from "../api/types";
import type { EventCategory } from "../api/types";
import { ApiDown, CatBadge, Mini, Notice, ReportDetail, Skeleton, StatusBadge, catOf, place, timeAgo, useLoad } from "../ui";

const PER = 15;
export function Events() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get("q") ?? "";
  const [cat, setCat] = useState<EventCategory | "">("");
  const [scope, setScope] = useState<"all" | "verified" | "unverified">("all");
  const [state, setState] = useState("");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Rep | null>(null);
  const data = useLoad(() => listReports({ category: cat ? [cat] : undefined, status: scope === "all" ? undefined : scope, state: state || undefined, limit: 500 }), [cat, scope, state], 30000);
  const rows = useMemo(() => (data.data?.items ?? []).filter((r) => !q || `${r.rawText} ${r.city} ${r.state} ${r.sourceId}`.toLowerCase().includes(q.toLowerCase())), [data.data, q]);
  const pages = Math.max(1, Math.ceil(rows.length / PER)), view = rows.slice(page * PER, page * PER + PER);
  const reset = (fn: () => void) => { fn(); setPage(0); };
  return (
    <>
      <div className="pagehead"><h1>Weather events</h1><p>Every report that has passed through the pipeline, newest first.</p></div>
      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ flex: 1, minWidth: 200 }} placeholder="Search text, city, state or source" value={q} onChange={(e) => { setSp(e.target.value ? { q: e.target.value } : {}); setPage(0); }} aria-label="Search events" />
        <select style={{ width: 170 }} value={cat} onChange={(e) => reset(() => setCat(e.target.value as EventCategory | ""))} aria-label="Event type"><option value="">All event types</option>{EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select>
        <select style={{ width: 170 }} value={state} onChange={(e) => reset(() => setState(e.target.value))} aria-label="State"><option value="">All states</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select>
        <div className="seg">{(["all", "verified", "unverified"] as const).map((k) => <button key={k} aria-pressed={scope === k} onClick={() => reset(() => setScope(k))}>{k === "all" ? "All" : k === "verified" ? "Verified" : "Unverified"}</button>)}</div>
      </div>
      <div className="card">
        {data.loading && !data.data ? <Skeleton h={360} /> : data.error && !data.data ? <ApiDown message={data.error} onRetry={data.reload} /> : rows.length === 0 ? <Notice title="No events match" body="Try a different search or clear a filter." /> : (
          <div className="tw"><table>
            <thead><tr><th>Trust</th><th>Event</th><th>Location</th><th>Source</th><th>Status</th><th>When</th></tr></thead>
            <tbody>{view.map((r) => <tr key={r.reportId} onClick={() => setSel(r)} style={{ cursor: "pointer" }}><td><Mini score={r.trustScore} /></td><td style={{ maxWidth: 340 }}><CatBadge cat={catOf(r)} /><div className="sub" style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{CAT_ICON[catOf(r)]} {r.rawText}</div></td><td>{place(r)}</td><td className="mono">{r.sourceId ?? r.sourceType}</td><td><StatusBadge status={r.verificationStatus} /></td><td>{timeAgo(r.submittedAt)}</td></tr>)}</tbody>
          </table></div>
        )}
        <div className="pager" style={{ marginTop: 12 }}><span>{rows.length} events</span><button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1} of {pages}</span><button className="btn sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
      </div>
      {sel && <ReportDetail r={sel} onClose={() => setSel(null)} />}
    </>
  );
}
