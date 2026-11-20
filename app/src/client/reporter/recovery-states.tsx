import { ClockIcon, InfoIcon } from "@primer/octicons-react";
import { useT } from "@/i18n/context.tsx";
import { BackToHome } from "@/ui/back-to-home.tsx";

/**
 * "Still saving your report" (SPEC 4.1): the final submit has not been confirmed yet, or the Report exists but its
 * links are still being written. The tab asks again by itself and survives a refresh through `sessionStorage`.
 */
export function StillSaving() {
  const t = useT();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <ClockIcon size={24} className="shrink-0 text-attention" aria-hidden="true" />
        <h1 className="text-xl font-semibold">{t("saving.title")}</h1>
      </div>
      <div role="status" className="flex flex-col gap-2 rounded-md border bg-card p-4">
        <p>{t("saving.description")}</p>
        <p className="text-muted-foreground">{t("saving.refresh")}</p>
      </div>
    </div>
  );
}

/**
 * The attempt needs a person (ADR 0005): a reference and the Deployment's contact instructions, and no button
 * to send the report again, because another create could duplicate it.
 */
export function NeedsHelp({ reference, contact }: { reference: string; contact: string }) {
  const t = useT();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <InfoIcon size={24} className="shrink-0 text-attention" aria-hidden="true" />
        <h1 className="text-xl font-semibold">{t("help.title")}</h1>
      </div>
      <p>{t("help.description")}</p>
      <dl className="flex flex-col gap-4 rounded-md border bg-card p-4">
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold text-muted-foreground">{t("help.reference")}</dt>
          <dd className="text-base font-semibold tracking-wide">{reference}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold text-muted-foreground">{t("help.contact")}</dt>
          <dd className="break-words">{contact}</dd>
        </div>
      </dl>
      <p className="text-muted-foreground">{t("help.noResend")}</p>
      <div>
        <BackToHome />
      </div>
    </div>
  );
}
