import { usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { BackToHome } from "@/ui/back-to-home.tsx";

/** Any address no route claims. */
export function NotFound() {
  const t = useT();
  const { displayName } = usePublicConfig();
  useDocumentTitle(t("notFound.title"), displayName);
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-xl font-semibold">{t("notFound.title")}</h1>
      <p className="text-muted-foreground">{t("notFound.description")}</p>
      <BackToHome />
    </div>
  );
}
