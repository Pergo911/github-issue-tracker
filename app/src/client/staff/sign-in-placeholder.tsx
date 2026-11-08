import { usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { BackToHome } from "@/ui/back-to-home.tsx";

/**
 * Placeholder for the Staff sign-in, replaced by ticket #27. Everything under `staff/` is its own chunk
 * (SPEC 2.6): it is reached only through a lazy route, and `reporter/` never imports it.
 */
export function Component() {
  const t = useT();
  const { displayName } = usePublicConfig();
  useDocumentTitle(t("home.staff.title"), displayName);
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-semibold">{t("home.staff.title")}</h1>
      <p className="text-muted-foreground">{t("placeholder.comingSoon")}</p>
      <BackToHome />
    </div>
  );
}
