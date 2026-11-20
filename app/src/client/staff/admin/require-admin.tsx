import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useStaff } from "../auth/staff-context.tsx";

/** The Admin-only screens (SPEC 2.4): anyone below System admin is sent back to the Reports. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { role } = useStaff();
  if (role !== "admin") return <Navigate to="/staff/reports" replace />;
  return children;
}
