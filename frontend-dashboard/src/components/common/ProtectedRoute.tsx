// src/components/common/ProtectedRoute.tsx
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
//import type { UserRole } from "../../types";
interface Props {
  children: React.ReactNode;
  roles?: UserRole[]; // omit to allow any logged-in role
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <main className="page">Checking session…</main>;

  if (!user) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <main className="page">
        <h1>Not authorized</h1>
        <p>Your role ({user.role}) can't access this page.</p>
      </main>
    );
  }

  return <>{children}</>;
}