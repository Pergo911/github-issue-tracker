import { CheckCircleFillIcon } from "@primer/octicons-react";
import { useT } from "@/i18n/context.tsx";
import { BackToHome } from "@/ui/back-to-home.tsx";
import { Button } from "@/ui/button.tsx";

export interface FiledReport {
  number: number;
  title: string;
  statusUrl: string;
}

/** The page after a Report was filed: its number, title and the permanent Status link (SPEC 4.1). */
export function Confirmation({
  report,
  onAnother,
}: {
  report: FiledReport;
  onAnother: () => void;
}) {
  const t = useT();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <CheckCircleFillIcon size={24} className="shrink-0 text-state-open" aria-hidden="true" />
        <h1 className="text-xl font-semibold">{t("confirmation.title")}</h1>
      </div>
      <dl className="flex flex-col gap-4 rounded-md border bg-card p-4">
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold text-muted-foreground">
            {t("confirmation.number")}
          </dt>
          <dd className="text-base font-semibold">#{report.number}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold text-muted-foreground">
            {t("confirmation.reportTitle")}
          </dt>
          <dd className="break-words">{report.title}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-semibold text-muted-foreground">{t("confirmation.link")}</dt>
          <dd>
            <a
              href={report.statusUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-link underline"
            >
              {report.statusUrl}
            </a>
          </dd>
        </div>
      </dl>
      <p className="text-muted-foreground">{t("confirmation.keep")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onAnother}>
          {t("confirmation.another")}
        </Button>
        <BackToHome />
      </div>
    </div>
  );
}
