import { AlertIcon } from "@primer/octicons-react";
import type { ReactNode } from "react";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { Button } from "@/ui/button.tsx";

/** The neutral state shown while the configuration loads: no branding, no language yet. */
export function LoadingScreen() {
  const t = useT();
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div role="status" className="flex items-center justify-center">
        <span
          aria-hidden="true"
          className="size-8 animate-spin rounded-full border-2 border-border border-t-link motion-reduce:animate-none"
        />
        <span className="sr-only">{t("boot.loading")}</span>
      </div>
    </main>
  );
}

function BootMessage({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-md border bg-card p-6 text-center shadow-resting">
        <AlertIcon size={32} className="text-attention" aria-hidden="true" />
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
        {action}
      </div>
    </main>
  );
}

/** The Deployment has no `config` key yet (SPEC 2.4): English, since no language is known. */
export function NotConfiguredScreen() {
  const t = useT();
  return (
    <BootMessage
      title={t("boot.notConfigured.title")}
      description={t("boot.notConfigured.description")}
      action={
        // A full page load on purpose: the router is not running while the Deployment has no configuration.
        <a href="/staff" className="text-link hover:underline">
          {t("boot.staffLink")}
        </a>
      }
    />
  );
}

/** The configuration request failed: English, with an explicit retry. */
export function FetchFailedScreen({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <BootMessage
      title={t("boot.fetchFailed.title")}
      description={t("boot.fetchFailed.description")}
      action={
        <Button variant="secondary" onClick={onRetry}>
          {t("boot.retry")}
        </Button>
      }
    />
  );
}
