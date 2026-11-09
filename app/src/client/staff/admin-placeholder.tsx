import { Navigate } from "react-router";
import { usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { useStaff } from "./auth/staff-context.tsx";

/**
 * Stands in for the Admin-only screens (Allowlist, Configuration) that later tickets build. It already enforces
 * the gate: anyone below System admin is sent back to the Reports.
 */
export function AdminPlaceholder({ title }: { title: string }) {
  const t = useT();
  const { displayName } = usePublicConfig();
  const { role } = useStaff();
  useDocumentTitle(title, displayName);
  if (role !== "admin") return <Navigate to="/staff/reports" replace />;
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{t("placeholder.comingSoon")}</p>
    </div>
  );
}
