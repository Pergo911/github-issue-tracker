import type { StatusBody } from "@shared/status/view.ts";
import { useT } from "@/i18n/context.tsx";

/**
 * A Report's body as plain text (SPEC 4.1, 4.3): the decoded Exact place and description, or, when the body is not
 * the canonical envelope, the raw text with a note. No Markdown pipeline. The Status page and the Staff Detail view
 * share it.
 */
export function ReportBody({ body }: { body: StatusBody }) {
  const t = useT();
  return (
    <section aria-labelledby="body-heading" className="rounded-md border">
      <h2
        id="body-heading"
        className="rounded-t-md border-b border-border-subtle bg-muted py-1 pr-1 pl-4 text-sm font-semibold"
      >
        {t("status.body.heading")}
      </h2>
      <div className="m-4 flex flex-col gap-4 text-sm">
        {body.kind === "report" ? (
          <>
            {body.place !== null ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold text-muted-foreground">
                  {t("report.body.place")}
                </h3>
                <p className="break-words whitespace-pre-wrap">{body.place}</p>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold text-muted-foreground">
                {t("report.body.description")}
              </h3>
              <p className="break-words whitespace-pre-wrap">{body.description}</p>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{t("status.body.plainNote")}</p>
            <p className="break-words whitespace-pre-wrap">{body.text}</p>
          </div>
        )}
      </div>
    </section>
  );
}
