import { AlertIcon, IssueClosedIcon, IssueOpenedIcon, SkipIcon } from "@primer/octicons-react";
import { Link } from "react-router";
import { useFormatter } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { LabelPill } from "@/ui/label-pill.tsx";
import type { ReportRow } from "./model.ts";

function StateIcon({ row }: { row: ReportRow }) {
  const t = useT();
  if (row.state === "open") {
    return (
      <IssueOpenedIcon
        size={16}
        className="text-state-open"
        aria-label={t("reports.state.openIcon")}
      />
    );
  }
  return row.closedKind === "rejected" ? (
    <SkipIcon
      size={16}
      className="text-state-neutral"
      aria-label={t("reports.state.rejectedIcon")}
    />
  ) : (
    <IssueClosedIcon
      size={16}
      className="text-state-done"
      aria-label={t("reports.state.fixedIcon")}
    />
  );
}

/**
 * One Report in the List (docs/ui-github-look.md, "Issues-list row"): the state icon, the title, `#<number> ·
 * opened <age>`, the label pills in their configured colours, a warning when the Status needs correction, and
 * the assignee. A Report is never left out of the list because of what its labels say.
 */
export function ReportListRow({ row, now }: { row: ReportRow; now: number }) {
  const t = useT();
  const format = useFormatter();
  return (
    <li
      className="grid grid-cols-[auto_1fr] gap-x-2 border-t border-border-subtle px-4 py-2 first:border-t-0 hover:bg-muted md:grid-cols-[auto_1fr_auto]"
      data-report={row.number}
    >
      <span className="pt-2">
        <StateIcon row={row} />
      </span>
      <div className="flex min-w-0 flex-col gap-1 pt-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={`/staff/reports/${row.number}`}
            className="text-base font-medium break-words hover:text-link hover:underline"
            data-report-title=""
          >
            {row.title}
          </Link>
          {row.pills.map((pill) => (
            <LabelPill key={`${pill.dimension}:${pill.text}`} text={pill.text} color={pill.color} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("reports.row.meta", {
              number: row.number,
              age: format.relativeTime(row.createdAt, now),
            })}
          </span>
          {row.statusProblem ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-attention-muted px-2 py-0.5 font-medium text-attention">
              <AlertIcon size={12} aria-hidden="true" />
              {t(`reports.statusProblem.${row.statusProblem}`)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="col-start-2 pt-1 text-xs text-muted-foreground md:col-start-3 md:pt-2">
        {row.assignees.length > 0
          ? t("reports.row.assignedTo", { login: row.assignees.join(", ") })
          : null}
      </div>
    </li>
  );
}
