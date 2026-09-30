// src/App.tsx
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/common/ProtectedRoute";

//import Dashboard from "./pages/Dashboard";
import ReportForm from "./pages/ReportForm";
import TrackReport from "./pages/TrackReport";
import AdminLogin from "./pages/admin/AdminLogin";
import ReviewQueue from "./pages/admin/ReviewQueue";
import ReportReview from "./pages/admin/ReportReview";
import Config from "./pages/admin/Config";
import Users from "./pages/admin/Users";
function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="site-header">
      <Link to="/" className="brand">NWBDAP</Link>
      <nav aria-label="Main">
        <NavLink to="/">Dashboard</NavLink>
        <NavLink to="/report">Report an event</NavLink>
        <NavLink to="/track">Track a report</NavLink>
        {user ? (
          <>
            <NavLink to="/admin/queue">Review queue</NavLink>
            {user.role === "admin" && <NavLink to="/admin/users">Users</NavLink>}
            {user.role === "admin" && <NavLink to="/admin/config">Config</NavLink>}
            <button type="button" className="link-button" onClick={logout}>
              Log out ({user.email})
            </button>
          </>
        ) : (
          <NavLink to="/admin/login">Admin</NavLink>
        )}
      </nav>
    </header>
  );
}

function NotFound() {
  return (
    <main className="page">
      <h1>Page not found</h1>
      <p>Check the address, or go back to the <Link to="/">dashboard</Link>.</p>
    </main>
  );
}

function AppRoutes() {
  return (
    <Routes>
      
      <Route path="/report" element={<ReportForm />} />
      <Route path="/track" element={<TrackReport />} />
      <Route path="/track/:reportId" element={<TrackReport />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin/queue"
        element={
          <ProtectedRoute roles={["moderator", "admin"]}>
            <ReviewQueue />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/reports/:reportId"
        element={
          <ProtectedRoute roles={["moderator", "admin"]}>
            <ReportReview />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/config"
        element={
          <ProtectedRoute roles={["admin"]}>
            <Config />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute roles={["admin"]}>
            <Users />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Header />
      <AppRoutes />
    </AuthProvider>
  );
}