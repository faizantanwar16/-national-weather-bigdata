import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Activity, BarChart3, Bell, Database, FileText, Globe, LayoutDashboard, Lock, Menu, Plus, Search, Settings as Cog, ShieldCheck, TriangleAlert, Users as UsersIcon, Zap } from "lucide-react";
import { useAuth } from "./context";
import { API_URL, listAlerts, useDemo } from "./api/gateway";
import { Notice, useLoad } from "./ui";
import { Overview } from "./pages/Overview";
import { Dashboard } from "./pages/Dashboard";
import { Events } from "./pages/Events";
import { Analytics } from "./pages/Analytics";
import { Alerts } from "./pages/Alerts";
import { ReportForm } from "./pages/ReportForm";
import { TrackReport } from "./pages/TrackReport";
import { AdminLogin, Config, Health, ReviewConsole, Sources, Users } from "./pages/Admin";

type Item = { to: string; label: string; icon: typeof Globe; lock?: "staff" | "admin" };
const MAIN: Item[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard }, { to: "/map", label: "Live Map", icon: Globe }, { to: "/events", label: "Weather Events", icon: Zap },
  { to: "/analytics", label: "Analytics", icon: BarChart3 }, { to: "/report", label: "Reports", icon: FileText }, { to: "/verification", label: "Verification", icon: ShieldCheck, lock: "staff" },
  { to: "/alerts", label: "Alerts", icon: TriangleAlert }, { to: "/sources", label: "Data Sources", icon: Database, lock: "admin" },
];
const ADMIN: Item[] = [{ to: "/admin", label: "Admin Panel", icon: UsersIcon, lock: "admin" }, { to: "/health", label: "System Health", icon: Activity, lock: "admin" }, { to: "/settings", label: "Settings", icon: Cog, lock: "admin" }];
const TITLES: Record<string, string> = { "/": "Overview", "/map": "Live Map", "/events": "Weather Events", "/analytics": "Analytics", "/report": "Submit Report", "/track": "Track Report", "/alerts": "Alerts", "/verification": "Verification", "/sources": "Data Sources", "/admin": "Admin Panel", "/health": "System Health", "/settings": "Settings", "/admin/login": "Staff Sign In" };

function useNow() { const [n, setN] = useState(new Date()); useEffect(() => { const t = setInterval(() => setN(new Date()), 1000); return () => clearInterval(t); }, []); return n; }

function Layout() {
  const { user, signOut } = useAuth();
  const demo = useDemo();
  const loc = useLocation(), nav = useNavigate();
  const [col, setCol] = useState(false), [open, setOpen] = useState(false), [q, setQ] = useState("");
  const now = useNow();
  const health = useLoad(async () => (demo ? true : (await fetch(`${API_URL}/health`)).ok), [demo], 30000);
  const alerts = useLoad(listAlerts, [], 120000);
  const hot = (alerts.data?.items ?? []).some((a) => a.severity === "extreme" || a.severity === "severe");
  const base = "/" + (loc.pathname.split("/")[1] ?? ""), title = TITLES[loc.pathname] ?? TITLES[base] ?? "";
  useEffect(() => setOpen(false), [loc.pathname]);
  const ok = !health.error && health.data !== false;
  const fmt = (o: Intl.DateTimeFormatOptions) => now.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", ...o });
  const link = (it: Item) => {
    const I = it.icon, locked = it.lock && (!user || (it.lock === "admin" && user.role !== "admin"));
    return <NavLink key={it.to} to={it.to} end={it.to === "/"} className={({ isActive }) => `ni${isActive ? " on" : ""}`} title={it.label}><I size={19} /><span>{it.label}</span>{locked && <Lock size={14} className="lk" />}</NavLink>;
  };
  return (
    <div className={`app${col ? " col" : ""}${open ? " open" : ""}`}>
      <div className="scrim2" onClick={() => setOpen(false)} />
      <aside className="sb">
        <NavLink to="/" className="brand"><span className="lg">IN</span><div><b>NWA Platform</b><span>Real-Time Weather Intelligence</span></div></NavLink>
        <nav className="nav" aria-label="Main">{MAIN.map(link)}<hr />{ADMIN.map(link)}</nav>
        <div className="sbf"><span className="av">{user ? user.email[0].toUpperCase() : "G"}</span><div style={{ flex: 1, minWidth: 0 }}><b>{user ? (user.role === "admin" ? "Admin" : "Moderator") : "Guest"}</b>{user ? <span>● Online · <button onClick={signOut} style={{ all: "unset", cursor: "pointer", color: "var(--mute)", textDecoration: "underline" }}>sign out</button></span> : <NavLink to="/admin/login" style={{ color: "var(--cyan)", fontSize: 12.5 }}>Staff sign in</NavLink>}</div></div>
      </aside>
      <div className="main">
        <header className="tb">
          <button className="ib" aria-label="Toggle sidebar" onClick={() => (window.innerWidth <= 1000 ? setOpen(!open) : setCol(!col))}><Menu size={20} /></button>
          <form className="srch hidem" onSubmit={(e) => { e.preventDefault(); nav(`/events?q=${encodeURIComponent(q)}`); }}><Search size={17} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events, locations, reports..." aria-label="Search" /></form>
          <span className="sp" />
          <span className="mono-pill" style={{ "--c": demo ? "#EAB308" : "#22D3EE" } as React.CSSProperties} title={demo ? "Backend not reachable, showing sample data" : "Connected to your backend"}><i />{demo ? "DEMO DATA" : "LIVE DATA"}</span>
          <div className="clock hidem"><div>{fmt({ day: "2-digit", month: "short", year: "numeric" })}, {fmt({ hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</div><small>IST · Indian Standard Time</small></div>
          <span className="mono-pill hidem" style={{ "--c": ok ? "#22C55E" : "#EF4444", fontFamily: "Inter, system-ui, sans-serif", letterSpacing: 0 } as React.CSSProperties}><i />{ok ? "All Systems" : "API offline"}</span>
          <NavLink to="/alerts" className="ib" aria-label="Alerts">{hot && <i />}<Bell size={20} /></NavLink>
          <NavLink to="/report" className="btn out"><Plus size={16} />Report</NavLink>
        </header>
        <div className="crumb">National Weather Analytics / <b>{title}</b></div>
        {demo && <div className="banner">Demo mode: your backend isn’t reachable, so this is realistic sample data. Start backend-api to see live data.</div>}
        <main className={`content${loc.pathname === "/map" ? " bleed" : ""}`}><Outlet /></main>
      </div>
    </div>
  );
}

function Guard({ admin, children }: { admin?: boolean; children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <Notice title="Checking your session…" />;
  if (!user) return <Navigate to="/admin/login" replace />;
  if (admin && user.role !== "admin") return <Notice title="Admins only" body="Your account can review reports but can’t open this page." />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/map" element={<Dashboard />} />
        <Route path="/events" element={<Events />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/report" element={<ReportForm />} />
        <Route path="/track" element={<TrackReport />} />
        <Route path="/track/:reportId" element={<TrackReport />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/verification" element={<Guard><ReviewConsole /></Guard>} />
        <Route path="/verification/:reportId" element={<Guard><ReviewConsole /></Guard>} />
        <Route path="/sources" element={<Guard admin><Sources /></Guard>} />
        <Route path="/admin" element={<Guard admin><Users /></Guard>} />
        <Route path="/health" element={<Guard admin><Health /></Guard>} />
        <Route path="/settings" element={<Guard admin><Config /></Guard>} />
        <Route path="*" element={<Notice title="Page not found" body="Check the address or go back to the overview." />} />
      </Route>
    </Routes>
  );
}
