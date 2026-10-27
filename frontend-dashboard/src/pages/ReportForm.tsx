import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { Link } from "react-router-dom";
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useEffect } from "react";
import { Camera, Lock } from "lucide-react";
import { CITIES, STATES, nearestCity, submit, uploadMedia } from "../api/gateway";
import { CATEGORY_LABELS, EVENT_CATEGORIES } from "../api/types";
import type { EventCategory } from "../api/types";
import { useToast } from "../context";

const TILES = import.meta.env.VITE_NO_TILES === "1" ? null : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const OKT = ["image/jpeg", "image/png", "image/webp", "video/mp4"];
type Pos = { lat: number; lng: number };

function Pick({ pos, onPick }: { pos: Pos | null; onPick: (p: Pos) => void }) {
  const map = useMap();
  useMapEvents({ click: (e) => onPick({ lat: +e.latlng.lat.toFixed(5), lng: +e.latlng.lng.toFixed(5) }) });
  useEffect(() => { if (pos) map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 8), { duration: 0.6 }); }, [pos, map]);
  return pos ? <CircleMarker center={[pos.lat, pos.lng]} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: "#5BA2FF", fillOpacity: 1 }} /> : null;
}

export function ReportForm() {
  const toast = useToast();
  const [when, setWhen] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [text, setText] = useState("");
  const [cat, setCat] = useState<EventCategory | "">("");
  const [pos, setPos] = useState<Pos | null>(null);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const put = (p: Pos) => { setPos(p); const c = nearestCity(p.lat, p.lng); setCity(c[0]); setState(c[1]); };
  const locate = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => put({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) }), () => toast("Location permission was denied. Tap the map or type your city instead.", true)) : toast("This browser can’t share your location.", true);
  const addFiles = (list: FileList | File[]) => {
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!OKT.includes(f.type)) { toast(`${f.name}: use JPEG, PNG, WebP or MP4.`, true); continue; }
      if (f.size > (f.type === "video/mp4" ? 25 : 5) * 1048576) { toast(`${f.name} is too large (images 5 MB, video 25 MB).`, true); continue; }
      if (next.length >= 3) { toast("You can attach up to 3 files.", true); break; }
      next.push(f);
    }
    setFiles(next);
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); };
  const send = async () => {
    setBusy(true); setErr("");
    try {
      const media = files.length ? await uploadMedia(files) : [];
      if (files.length && !media.length) toast("Photos couldn’t be uploaded yet, so the report was sent without them.", true);
      const r = await submit({ rawText: text.trim(), claimedCategory: cat || undefined, city: city.trim() || undefined, state: state.trim() || undefined, ...(pos ? { latitude: pos.lat, longitude: pos.lng } : {}) }, media);
      setDone(r.reportId);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const submitForm = async () => {
    setErr("");
    if (!cat) return setErr("Choose the type of event.");
    if (text.trim().length < 12) return setErr("Describe what you observed in a little more detail (at least 12 characters).");
    if (!city.trim() || !state) return setErr("Add the city and state.");
    await send();
  };
  if (done) return (
    <section className="formcard narrow" style={{ textAlign: "center", justifyItems: "center", margin: "0 auto" }}>
      <div style={{ fontSize: 54 }}>✅</div><h2 style={{ fontSize: 26 }}>Report received</h2>
      <p className="sub">It is moving through checks now. Keep this ID to follow it.</p>
      <p className="mono" style={{ padding: 12, background: "var(--bg)", borderRadius: 10, wordBreak: "break-all", maxWidth: "100%" }}>{done}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <Link className="gradbtn" to={`/track/${done}`}>Watch it being checked</Link>
        <button className="btn" onClick={() => { navigator.clipboard?.writeText(done); toast("ID copied"); }}>Copy ID</button>
        <button className="btn" onClick={() => { setDone(null); setText(""); setCat(""); setFiles([]); setPos(null); setCity(""); setState(""); }}>Report another</button>
      </div>
    </section>
  );
  const cities = CITIES.filter((c) => !state || c[1] === state);
  return (
    <div style={{ maxWidth: 780, display: "grid", gap: 18 }}>
      <div className="pagehead"><h1>Report a Weather Event</h1><p style={{ color: "var(--cyan)" }}>Help build India’s most accurate weather intelligence network</p></div>
      <section className="formcard"><h3>Event details</h3>
        <label className="f">Event Type *<select value={cat} onChange={(e) => setCat(e.target.value as EventCategory | "")}><option value="">Select event type</option>{EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></label>
        <label className="f">Description *<textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe what you observed: road conditions, visibility, flooding depth, etc." /></label>
      </section>
      <section className="formcard"><h3>Location</h3>
        <div className="grid g2"><label className="f">City *<input list="cities" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Mumbai" /><datalist id="cities">{cities.map((c) => <option key={c[0]} value={c[0]} />)}</datalist></label><label className="f">State *<select value={state} onChange={(e) => setState(e.target.value)}><option value="">Select state</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select></label></div>
        <div className="grid g2"><label className="f">Date &amp; Time<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label><label className="f">GPS Coordinates<div style={{ display: "flex", gap: 8 }}><input readOnly value={pos ? `${pos.lat}, ${pos.lng}` : ""} placeholder="lat, lng (auto-detect)" className="mono" /><button type="button" className="btn out" onClick={locate}>Detect</button></div></label></div>
        <div className="pickmap"><MapContainer center={[22.6, 79]} zoom={5} style={{ height: "100%" }}>{TILES && <TileLayer url={TILES} subdomains="abcd" attribution="&copy; OpenStreetMap, &copy; CARTO" />}<Pick pos={pos} onPick={put} /></MapContainer></div><span className="sub">Or tap the map to drop a pin.</span>
      </section>
      <section className="formcard"><h3>Evidence upload</h3>
        <div className={`drop${over ? " over" : ""}`} style={{ padding: 34 }} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop} role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => e.key === "Enter" && input.current?.click()}>
          <Camera size={34} style={{ margin: "0 auto 8px" }} /><div style={{ fontSize: 17, color: "var(--ink)" }}>Drop photos or videos here</div><div className="sub">JPG, PNG, WebP up to 5 MB, MP4 up to 25 MB, max 3 files</div><span className="btn" style={{ marginTop: 12 }}>Browse Files</span>
          <input ref={input} type="file" hidden multiple accept={OKT.join(",")} onChange={(e) => e.target.files && addFiles(e.target.files)} />
        </div>
        {files.length > 0 && <div className="media">{files.map((f, i) => <div key={i} style={{ position: "relative" }}>{f.type.startsWith("video") ? <video src={URL.createObjectURL(f)} /> : <img src={URL.createObjectURL(f)} alt={f.name} />}<button type="button" className="btn sm" style={{ position: "absolute", top: 6, right: 6 }} onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>Remove</button></div>)}</div>}
      </section>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="gradbtn" style={{ padding: 17, fontSize: 16 }} disabled={busy} onClick={submitForm}>{busy ? "Sending…" : "Submit Weather Report"}</button>
      <div className="privacy"><Lock size={16} style={{ flex: "none", marginTop: 2 }} /><span>Your report is anonymous and checked by trust scoring before it is published. No name, phone number or email is collected. <Link to="/track" style={{ color: "var(--cyan)" }}>Track an earlier report</Link></span></div>
    </div>
  );
}
