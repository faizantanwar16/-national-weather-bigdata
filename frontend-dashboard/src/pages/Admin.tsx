import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { CAT_COLOR, CONFIG_DEFAULTS, addUser, audit, detail, editSource, editUser, getConfig, getHealth, getSources, getUsers, queue, setConfig, verify } from "../api/gateway";
import type { Rep } from "../api/gateway";
import { CATEGORY_LABELS, EVENT_CATEGORIES } from "../api/types";
import type { EventCategory } from "../api/types";
import { ApiDown, CatBadge, Gauge, Mini, Notice, Signals, Skeleton, StatusBadge, catOf, place, timeAgo, useLoad } from "../ui";
import { useAuth, useToast } from "../context";

export function AdminLogin() {
  const { user, signIn, signInDemo } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/verification" replace />;
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(""); try { await signIn(email, pw); nav("/verification"); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } };
  return (
    <div className="narrow" style={{ maxWidth: 430, display: "grid", gap: 14 }}>
      <form className="card" onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <div><h1 style={{ fontSize: 26 }}>Staff sign in</h1><p className="sub">For people who review flagged reports.</p></div>
        <label className="f">Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="f">Password<input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn pri" disabled={busy} style={{ justifyContent: "center" }}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <button className="btn" onClick={() => { signInDemo(); nav("/verification"); }} style={{ justifyContent: "center" }}>Explore the admin console with sample data</button>
    </div>
  );
}

export function ReviewConsole() {
  const { reportId } = useParams();
  const [cat, setCat] = useState("");
  const q = useLoad(() => queue({ category: cat || undefined }), [cat], 30000);
  const items = q.data?.items ?? [];
  const [selId, setSelId] = useState<string | undefined>(reportId);
  useEffect(() => { if ((!selId || !items.some((i) => i.reportId === selId)) && items[0] && !reportId) setSelId(items[0].reportId); }, [items, selId, reportId]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return;
      const i = items.findIndex((x) => x.reportId === selId);
      if (e.key === "j" && items[i + 1]) setSelId(items[i + 1].reportId);
      if (e.key === "k" && items[i - 1]) setSelId(items[i - 1].reportId);
    };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  }, [items, selId]);
  const decided = (id: string) => { const i = items.findIndex((x) => x.reportId === id); setSelId(items[i + 1]?.reportId ?? items[i - 1]?.reportId); q.reload(); };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
        <div className="pagehead"><h1>Verification</h1><p>{items.length} waiting, least trusted first. Keys: <span className="kbd">J</span> next, <span className="kbd">K</span> previous, <span className="kbd">A</span> approve, <span className="kbd">R</span> reject.</p></div>
        <select style={{ width: 190 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Event type"><option value="">All event types</option>{EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select>
      </div>
      {q.loading && !q.data ? <Skeleton h={420} /> : q.error && !q.data ? <div className="card"><ApiDown message={q.error} onRetry={q.reload} /></div> : items.length === 0 ? <div className="card"><Notice title="Queue is clear" body="Nothing needs a decision right now. New flagged reports will show up here." /></div> : (
        <div className="split">
          <div className="qlist" role="listbox" aria-label="Reports to review">{items.map((r) => <button key={r.reportId} className="qi" role="option" aria-selected={r.reportId === selId} aria-pressed={r.reportId === selId} onClick={() => setSelId(r.reportId)}><Mini score={r.trustScore} /><div><b style={{ fontSize: 14 }}>{place(r)} <span style={{ color: CAT_COLOR[catOf(r)] }}>●</span></b><p>{r.rawText}</p><span className="sub" style={{ fontSize: 12 }}>{timeAgo(r.submittedAt)}</span></div></button>)}</div>
          {selId ? <Pane key={selId} id={selId} onDone={decided} /> : <div className="card"><Notice title="Pick a report" /></div>}
        </div>
      )}
    </>
  );
}

function Pane({ id, onDone }: { id: string; onDone: (id: string) => void }) {
  const toast = useToast();
  const d = useLoad(() => detail(id), [id]);
  const a = useLoad(() => audit(id), [id]);
  const [comment, setComment] = useState(""); const [override, setOverride] = useState<EventCategory | "">(""); const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const act = async (action: "approve" | "reject") => {
    if (action === "reject" && !comment.trim()) { toast("Add a comment to explain the rejection.", true); box.current?.focus(); return; }
    setBusy(true);
    try { await verify(id, action, comment.trim() || undefined, override || undefined); toast(action === "approve" ? "Approved. It’s now on the public map." : "Rejected and hidden from the public."); onDone(id); } catch (e) { toast((e as Error).message, true); setBusy(false); }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) || busy) return; if (e.key === "a") act("approve"); if (e.key === "r") act("reject"); };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  });
  if (d.loading && !d.data) return <Skeleton h={420} />;
  if (d.error || !d.data) return <div className="card"><Notice title="Report not found" body={d.error ?? "It may already have been decided."} /></div>;
  const { report: r, cluster, source } = d.data as { report: Rep; cluster: Rep[]; source: import("../api/gateway").SourceRow | null };
  return (
    <section className="card" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><div><h2>{place(r)}</h2><span className="sub">{timeAgo(r.submittedAt)} · {r.sourceId ?? r.sourceType} · <span className="mono">{r.reportId.slice(0, 13)}</span></span></div><div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><StatusBadge status={r.verificationStatus} /><CatBadge cat={catOf(r)} />{r.lowConfidence && <span className="badge" style={{ "--c": "var(--amber)" } as CSSProperties}>Low confidence</span>}</div></div>
      {r.media.length > 0 && <div className="media">{r.media.map((m, i) => m.type === "video" ? <video key={i} src={m.url} controls /> : <img key={i} src={m.url} alt={`Evidence ${i + 1}`} />)}</div>}
      <p style={{ fontSize: 16 }}>{r.rawText}</p>
      <div className="grid g2" style={{ alignItems: "center" }}><div style={{ display: "flex", gap: 14, alignItems: "center" }}><Gauge score={r.trustScore} /><div className="sub">Category confidence {r.categoryConfidence !== undefined ? `${Math.round(r.categoryConfidence * 100)}%` : "n/a"}</div></div><Signals data={r.trustBreakdown} /></div>
      {r.trustReasons && r.trustReasons.length > 0 && <ul className="reasons">{r.trustReasons.map((t) => <li key={t}>{t}</li>)}</ul>}
      <div className="grid g2">
        <div className="card" style={{ background: "var(--bg)" }}><h3 style={{ fontSize: 15, marginBottom: 6 }}>Source history</h3>{source ? <div className="sub"><b style={{ color: "var(--ink)" }}>{source.id}</b><br />Reliability {Math.round(source.reliability * 100)}% · {source.reportCount} reports · {source.approved} approved · {source.rejected} rejected</div> : <p className="sub">No source history from the server yet.</p>}</div>
        <div className="card" style={{ background: "var(--bg)" }}><h3 style={{ fontSize: 15, marginBottom: 6 }}>Same event ({cluster.length})</h3>{cluster.length ? cluster.slice(0, 4).map((c) => <div key={c.reportId} className="sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.trustScore} · {c.rawText}</div>) : <p className="sub">No other reports are grouped with this one.</p>}</div>
      </div>
      <div className="card" style={{ background: "var(--bg)", display: "grid", gap: 10 }}>
        <div className="grid g2"><label className="f">Correct the event type<select value={override} onChange={(e) => setOverride(e.target.value as EventCategory | "")}><option value="">Keep {CATEGORY_LABELS[catOf(r)]}</option>{EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></label><label className="f">Comment (required to reject)<textarea ref={box} style={{ minHeight: 44 }} value={comment} onChange={(e) => setComment(e.target.value)} /></label></div>
        <div style={{ display: "flex", gap: 8 }}><button className="btn good" disabled={busy} onClick={() => act("approve")}>Approve <span className="kbd">A</span></button><button className="btn bad" disabled={busy} onClick={() => act("reject")}>Reject <span className="kbd">R</span></button></div>
      </div>
      <div><h3 style={{ fontSize: 15, marginBottom: 8 }}>History</h3>{(a.data?.items ?? []).length === 0 ? <p className="sub">No decisions logged yet.</p> : <div className="tl">{a.data!.items.map((x) => <div key={x.at}><b>{x.actor}</b> moved it from {x.fromStatus.replace("_", " ")} to {x.toStatus.replace("_", " ")}{x.comment && <><br />{x.comment}</>}<br /><small>{timeAgo(x.at)}</small></div>)}</div>}</div>
    </section>
  );
}

const FIELDS: { key: string; label: string; help: string; min: number; max: number; step: number }[] = [
  { key: "trust.autoVerifyThreshold", label: "Auto-verify threshold", help: "Reports at or above this trust score are verified without a moderator.", min: 0, max: 100, step: 1 },
  { key: "classification.minConfidence", label: "Minimum classifier confidence", help: "Below this, a report goes to review even if its trust score is high.", min: 0, max: 1, step: 0.05 },
  { key: "dedup.maxDistanceKm", label: "Group reports within (km)", help: "Distance limit when merging reports about the same event.", min: 1, max: 100, step: 1 },
  { key: "dedup.windowMinutes", label: "Group reports within (minutes)", help: "Time window for merging reports.", min: 10, max: 720, step: 10 },
  { key: "dedup.similarityThreshold", label: "Similarity needed to merge", help: "Higher means fewer merges.", min: 0.3, max: 0.95, step: 0.01 },
  { key: "hotspot.minSources", label: "Sources needed for a hotspot", help: "Distinct sources reporting the same event type nearby.", min: 2, max: 20, step: 1 },
  { key: "collectors.social.intervalSec", label: "Social polling (seconds)", help: "How often the social collector checks for posts.", min: 15, max: 600, step: 15 },
  { key: "collectors.api.intervalSec", label: "Weather API polling (seconds)", help: "How often official observations are fetched.", min: 300, max: 3600, step: 60 },
];

export function Config() {
  const toast = useToast();
  const c = useLoad(getConfig, []);
  const qd = useLoad(() => queue(), []);
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState<Record<string, unknown>>({});
  const [tag, setTag] = useState("");
  useEffect(() => { if (c.data) { const m = { ...CONFIG_DEFAULTS, ...Object.fromEntries(c.data.items.map((i) => [i.key, i.value])) }; setVals(m); setSaved(m); } }, [c.data]);
  const dirty = Object.keys(vals).filter((k) => JSON.stringify(vals[k]) !== JSON.stringify(saved[k]));
  const thr = Number(vals["trust.autoVerifyThreshold"] ?? 75);
  const flips = (qd.data?.items ?? []).filter((r) => (r.trustScore ?? 0) >= thr && !r.lowConfidence).length;
  const tags = (vals["collectors.hashtags"] as string[]) ?? [];
  const save = async () => { try { for (const k of dirty) await setConfig(k, vals[k]); toast(`Saved ${dirty.length} setting${dirty.length > 1 ? "s" : ""}. Services pick them up within a minute.`); c.reload(); } catch (e) { toast((e as Error).message, true); } };
  if (c.loading && !c.data) return <Skeleton h={400} />;
  if (c.error && !c.data) return <div className="card"><ApiDown message={c.error} onRetry={c.reload} /></div>;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}><div className="pagehead"><h1>Settings</h1><p>Tune the pipeline without redeploying. Changes apply to new reports.</p></div><button className="btn pri" disabled={!dirty.length} onClick={save}>{dirty.length ? `Save ${dirty.length} change${dirty.length > 1 ? "s" : ""}` : "No changes"}</button></div>
      <div className="grid g21">
        <div className="card" style={{ display: "grid", gap: 18 }}>
          {FIELDS.map((f) => { const v = Number(vals[f.key] ?? 0); return <label className="f" key={f.key}><span style={{ display: "flex", justifyContent: "space-between" }}>{f.label}<span className="mono" style={{ color: JSON.stringify(vals[f.key]) !== JSON.stringify(saved[f.key]) ? "var(--amber)" : "var(--ink)" }}>{v}</span></span><input type="range" min={f.min} max={f.max} step={f.step} value={v} onChange={(e) => setVals({ ...vals, [f.key]: +e.target.value })} /><span className="sub" style={{ fontWeight: 400 }}>{f.help}</span></label>; })}
          <div className="f"><span>Hashtags to follow</span><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{tags.map((t) => <button key={t} className="chip" onClick={() => setVals({ ...vals, "collectors.hashtags": tags.filter((x) => x !== t) })} aria-label={`Remove ${t}`}>{t} ✕</button>)}</div><form style={{ display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); const t = tag.trim().startsWith("#") ? tag.trim() : `#${tag.trim()}`; if (tag.trim() && !tags.includes(t)) setVals({ ...vals, "collectors.hashtags": [...tags, t] }); setTag(""); }}><input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="#cyclone" /><button className="btn">Add</button></form></div>
        </div>
        <div className="card" style={{ alignSelf: "start", display: "grid", gap: 12 }}>
          <h2>What this threshold does</h2>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}><Gauge score={thr} size={96} /><p className="sub">At <b style={{ color: "var(--ink)" }}>{thr}</b>, <b style={{ color: "var(--teal)" }}>{flips}</b> of the {qd.data?.items.length ?? 0} reports waiting in the queue would be verified automatically.</p></div>
          <p className="sub">Moderators never lose control: the system can verify or send to review, but only people can reject.</p>
        </div>
      </div>
    </>
  );
}

export function Users() {
  const toast = useToast();
  const u = useLoad(getUsers, []);
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [role, setRole] = useState<"moderator" | "admin">("moderator");
  const add = async (e: FormEvent) => { e.preventDefault(); try { await addUser(email, pw, role); toast("User created"); setEmail(""); setPw(""); u.reload(); } catch (x) { toast((x as Error).message, true); } };
  const edit = async (id: string, b: { active?: boolean; role?: "moderator" | "admin" }) => { try { await editUser(id, b); u.reload(); } catch (x) { toast((x as Error).message, true); } };
  return (
    <>
      <div className="pagehead"><h1>Admin panel</h1><p>Team members who can sign in and review reports.</p></div>
      <div className="grid g21">
        <section className="card">{u.loading && !u.data ? <Skeleton h={160} /> : u.error && !u.data ? <ApiDown message={u.error} onRetry={u.reload} /> : <div className="tw"><table><thead><tr><th>Email</th><th>Role</th><th>Active</th><th>Last sign in</th></tr></thead><tbody>{u.data!.items.map((m) => <tr key={m._id}><td>{m.email}</td><td><select value={m.role} onChange={(e) => edit(m._id, { role: e.target.value as "moderator" | "admin" })}><option value="moderator">Moderator</option><option value="admin">Admin</option></select></td><td><input type="checkbox" checked={m.active} onChange={(e) => edit(m._id, { active: e.target.checked })} aria-label={`${m.email} active`} /></td><td>{m.lastLoginAt ? timeAgo(m.lastLoginAt) : "Never"}</td></tr>)}</tbody></table></div>}</section>
        <form className="card" onSubmit={add} style={{ display: "grid", gap: 12, alignContent: "start" }}><h2>Add a team member</h2><label className="f">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label className="f">Password (8 or more characters)<input type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} required /></label><label className="f">Role<select value={role} onChange={(e) => setRole(e.target.value as "moderator" | "admin")}><option value="moderator">Moderator</option><option value="admin">Admin</option></select></label><button className="btn pri">Create user</button></form>
      </div>
    </>
  );
}

export function Health() {
  const h = useLoad(getHealth, [], 4000);
  return (
    <>
      <div className="pagehead"><h1>System health</h1><p>Is the stream healthy? Lag per stage, throughput and failed messages.</p></div>
      {h.error && !h.data ? <div className="card"><ApiDown message={h.error} onRetry={h.reload} /></div> : h.data && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
          {h.data.stages.map((st) => <div className="card" key={st.name}><span className="sub">{st.name} consumer</span><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><b style={{ font: "800 30px 'Inter',system-ui,sans-serif", color: st.lag > 5 ? "var(--amber)" : "var(--teal)" }}>{st.lag}</b><span className="sub">lag · {st.rate}/min</span></div><div className="spark" aria-hidden>{st.spark.map((v, i) => <i key={i} style={{ height: `${v * 2.4}%` }} />)}</div></div>)}
          <div className="card"><span className="sub">Failed reports (dead letters)</span><b style={{ display: "block", font: "800 30px 'Inter',system-ui,sans-serif", color: h.data.dlq ? "var(--rose)" : "var(--teal)" }}>{h.data.dlq}</b><span className="sub">{h.data.queued} waiting in the stream</span></div>
        </div>
      )}
    </>
  );
}

export function Sources() {
  const toast = useToast();
  const s = useLoad(getSources, []);
  const flip = async (id: string, b: { blocked?: boolean; allowListed?: boolean }) => { try { await editSource(id, b); s.reload(); } catch (e) { toast((e as Error).message, true); } };
  return (
    <>
      <div className="pagehead"><h1>Data sources</h1><p>Which sources feed the pipeline, and how much each one is trusted.</p></div>
      <section className="card">
        {s.loading && !s.data ? <Skeleton h={180} /> : s.error && !s.data ? <ApiDown message={s.error} onRetry={s.reload} /> : <div className="tw"><table><thead><tr><th>Source</th><th>Reliability</th><th>Reports</th><th>Approved / rejected</th><th>Allow-list</th><th>Block</th></tr></thead><tbody>{s.data!.items.map((x) => <tr key={x.id}><td className="mono">{x.id}</td><td style={{ minWidth: 150 }}><div className="meter"><i style={{ width: `${x.reliability * 100}%` }} /></div><span className="sub">{Math.round(x.reliability * 100)}%</span></td><td>{x.reportCount}</td><td>{x.approved} / {x.rejected}</td><td><input type="checkbox" checked={x.allowListed} onChange={(e) => flip(x.id, { allowListed: e.target.checked })} aria-label={`Allow-list ${x.id}`} /></td><td><input type="checkbox" checked={x.blocked} onChange={(e) => flip(x.id, { blocked: e.target.checked })} aria-label={`Block ${x.id}`} /></td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
