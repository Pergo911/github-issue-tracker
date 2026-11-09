import { useT } from "@/i18n/context.tsx";
import { AdminPlaceholder } from "./admin-placeholder.tsx";

/** The Configuration screen's place (Admin-only), until its ticket builds it. */
export function Component() {
  const t = useT();
  return <AdminPlaceholder title={t("staff.nav.configuration")} />;
}
