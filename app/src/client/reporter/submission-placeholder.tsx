import { usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { BackToHome } from "@/ui/back-to-home.tsx";

/** Placeholder for the Submission form, replaced by ticket #23. Lazy: reporters never download `staff/`. */
export function Component() {
  const t = useT();
  const { displayName } = usePublicConfig();
  useDocumentTitle(t("home.submission.title"), displayName);
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-semibold">{t("home.submission.title")}</h1>
      <p className="text-muted-foreground">{t("placeholder.comingSoon")}</p>
      <BackToHome />
    </div>
  );
}
