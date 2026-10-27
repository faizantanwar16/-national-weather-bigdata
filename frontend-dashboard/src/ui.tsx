import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";
import type { EventCategory, VerificationStatus } from "./api/types";
import { CATEGORY_LABELS } from "./api/types";
import { API_URL, CAT_COLOR, CAT_ICON } from "./api/gateway";
import type { Rep } from "./api/gateway";

const v = (o: Record<string, string | number>) => o as CSSProperties;
export const timeAgo = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};
export const scoreColor = (s?: number) => (s === undefined ? "var(--mute)" : s >= 75 ? "var(--teal)" : s >= 40 ? "var(--amber)" : "var(--rose)");
export const ST_LABEL: Record<VerificationStatus, string> = { verified: "Verified", pending: "Processing", needs_review: "Needs review", rejected: "Rejected" };
export const ST_COLOR: Record<VerificationStatus, string> = { verified: "var(--teal)", pending: "var(--blue)", needs_review: "var(--amber)", rejected: "var(--rose)" };
export const place = (r: Rep) => [r.city, r.state].filter(Boolean).join(", ") || "Location not given";
export const catOf = (r: Rep): EventCategory => r.category ?? r.claimedCategory ?? "other";
export const SIGNALS = [["sourceReliability", "Source reliability", 25], ["corroboration", "Corroboration", 25], ["officialMatch", "Official data match", 25], ["media", "Media evidence", 15], ["text", "Text plausibility", 10]] as const;

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], every?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => fn().then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message || "Request failed")).finally(() => setLoading(false)), deps);
  useEffect(() => { setLoading(true); run(); if (!every) return; const t = setInterval(run, every); return () => clearInterval(t); }, [run, every]);
  return { data, error, loading, reload: run };
}

export function Gauge({ score, size = 118 }: { score?: number; size?: number }) {
  const r = size / 2 - 9, c = 2 * Math.PI * r, s = score ?? 0, [shown, setShown] = useState(0);
  useEffect(() => { const t = setTimeout(() => setShown(s), 60); return () => clearTimeout(t); }, [s]);
  return (
    <div className="gauge" style={{ width: size, height: size }} role="img" aria-label={`Trust score ${score ?? "unknown"} out of 100`}>
      <svg width={size} height={size}><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--card2)" strokeWidth="9" /><circle className="v" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(score)} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)} /></svg>
      <div><b>{score === undefined ? "–" : Math.round(s)}</b><small>trust</small></div>
    </div>
  );
}
export function Signals({ data }: { data?: Record<string, number> }) {
  if (!data) return <p className="sub">No signal breakdown. Official sources score a fixed 95, and unprocessed reports have none yet.</p>;
  return <div>{SIGNALS.map(([k, label, max]) => data[k] === undefined ? null : <div className="sig" key={k}><span>{label}</span><div className="t"><i style={{ width: `${Math.min(100, (data[k] / max) * 100)}%` }} /></div><span className="mono">{data[k]}/{max}</span></div>)}</div>;
}
export const CatBadge = ({ cat }: { cat: EventCategory }) => <span className="badge" style={v({ "--c": CAT_COLOR[cat] })}>{CAT_ICON[cat]} {CATEGORY_LABELS[cat]}</span>;
export const StatusBadge = ({ status }: { status: VerificationStatus }) => <span className="badge" style={v({ "--c": ST_COLOR[status] })}>{ST_LABEL[status]}</span>;
export const Mini = ({ score }: { score?: number }) => <div className="mini" style={v({ "--s": score ?? 0, "--c": scoreColor(score) })}><span style={{ background: "var(--bg)", borderRadius: "50%", width: 32, height: 32, display: "grid", placeItems: "center" }}>{score === undefined ? "–" : Math.round(score)}</span></div>;
export const Notice = ({ title, body, action }: { title: string; body?: string; action?: ReactNode }) => <div className="state"><h3>{title}</h3>{body && <p style={{ maxWidth: 460 }}>{body}</p>}{action}</div>;
export const ApiDown = ({ message, onRetry }: { message: string; onRetry?: () => void }) => <Notice title="Can’t load this yet" body={`${message}. If you expected data here, check that backend-api is running at ${API_URL}.`} action={onRetry && <button className="btn" onClick={onRetry}>Try again</button>} />;
export const Skeleton = ({ h = 120 }: { h?: number }) => <div className="skeleton" style={{ height: h }} />;

export function ReportDetail({ r, onClose }: { r: Rep; onClose: () => void }) {
  return (
    <aside className="glass drawer" role="dialog" aria-label="Report details" style={{ position: "fixed", top: 80, right: 16, bottom: 16, zIndex: 70 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><div><h2>{place(r)}</h2><span className="sub">{timeAgo(r.submittedAt)} · {r.sourceId ?? r.sourceType}</span></div><button className="btn sm" onClick={onClose}>Close</button></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><StatusBadge status={r.verificationStatus} /><CatBadge cat={catOf(r)} /></div>
      {r.media.length > 0 && <div className="media">{r.media.map((m, i) => m.type === "video" ? <video key={i} src={m.url} controls /> : <img key={i} src={m.url} alt={`Report media ${i + 1}`} />)}</div>}
      <p>{r.rawText}</p>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}><Gauge score={r.trustScore} /><div className="sub">Trust score out of 100.{r.verifiedBy === "moderator" ? " A moderator made the final call." : ""}</div></div>
      <Signals data={r.trustBreakdown} />
      {r.trustReasons && r.trustReasons.length > 0 && <ul className="reasons">{r.trustReasons.map((t) => <li key={t}>{t}</li>)}</ul>}
      <Link className="btn" to={`/track/${r.reportId}`}>Open tracking page</Link>
    </aside>
  );
}
