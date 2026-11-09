import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/ui/button.tsx";
import { useStaff } from "../auth/staff-context.tsx";
import { FilterBar } from "./filter-bar.tsx";
import { filterReports, sortReports, toReportRow } from "./model.ts";
import { reportSearchQuery, reportsQuery } from "./queries.ts";
import { ReportListRow } from "./report-row.tsx";
import { listViewToParams, parseListView, type ListView } from "./view-state.ts";

function Empty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}

/**
 * The List view (SPEC 2.4): every Report from the repo through `githubFetch`, filtered client-side, sorted by the
 * configured Priority then oldest first. Its state lives in the URL. A search goes through GitHub's search API.
 * An invalid Status warns on the row; no Report ever disappears.
 */
export function Component() {
  const t = useT();
  const { displayName, taxonomy } = usePublicConfig();
  const { repo } = useStaff();
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseListView(params), [params]);
  useDocumentTitle(t("reports.title"), displayName);

  const searching = view.q !== "";
  const all = useQuery({ ...reportsQuery(repo), enabled: !searching });
  const found = useQuery({ ...reportSearchQuery(repo, view.q), enabled: searching });
  const active = searching ? found : all;

  const rows = useMemo(
    () => (active.data ?? []).map((issue) => toReportRow(issue, taxonomy)),
    [active.data, taxonomy],
  );
  const visible = useMemo(
    () =>
      sortReports(
        filterReports(rows, { ...view, state: searching ? "any" : view.state }),
        taxonomy,
      ),
    [rows, view, searching, taxonomy],
  );
  const assignees = useMemo(() => [...new Set(rows.flatMap((row) => row.assignees))], [rows]);
  // The age of a Report is counted from when the list was fetched, so a re-render never changes it.
  const now = active.dataUpdatedAt;

  const change = (patch: Partial<Record<keyof ListView, string | boolean | undefined>>) => {
    const next = { ...view, ...patch } as Record<string, unknown>;
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    setParams(listViewToParams(next as unknown as ListView, params));
  };

  let body;
  if (active.isPending) {
    body = (
      <div
        role="status"
        className="flex items-center justify-center gap-3 px-4 py-12 text-muted-foreground"
      >
        <span
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-border border-t-link motion-reduce:animate-none"
        />
        {t("reports.loading")}
      </div>
    );
  } else if (active.isError) {
    body = (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <h2 className="text-base font-semibold">{t("reports.error.title")}</h2>
        <p className="text-muted-foreground">{t("reports.error.description")}</p>
        <Button variant="secondary" onClick={() => void active.refetch()}>
          {t("boot.retry")}
        </Button>
      </div>
    );
  } else if (visible.length === 0) {
    const key = searching ? "search" : rows.length === 0 ? "none" : "filtered";
    body = (
      <Empty
        title={t(`reports.empty.${key}.title`)}
        description={t(`reports.empty.${key}.description`)}
      />
    );
  } else {
    body = (
      <ul>
        {visible.map((row) => (
          <ReportListRow key={row.number} row={row} now={now} />
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("reports.title")}</h1>
      <FilterBar
        view={view}
        taxonomy={taxonomy}
        assignees={assignees}
        refreshing={active.isFetching}
        onChange={change}
        onRefresh={() => void active.refetch()}
      />
      {searching ? (
        <p className="text-sm text-muted-foreground">
          {t("reports.search.active", { query: view.q })}{" "}
          <button
            type="button"
            className="text-link hover:underline"
            onClick={() => change({ q: "" })}
          >
            {t("reports.search.clear")}
          </button>
        </p>
      ) : null}
      <div className="overflow-hidden rounded-md border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted p-4">
          {searching ? null : (
            <div role="group" aria-label={t("reports.state.label")} className="flex gap-1">
              {(["open", "closed"] as const).map((state) => (
                <button
                  key={state}
                  type="button"
                  aria-pressed={view.state === state}
                  onClick={() => change({ state })}
                  className={cn(
                    "h-7 rounded-md px-3 text-sm hover:bg-accent",
                    view.state === state && "bg-card font-semibold shadow-resting",
                  )}
                >
                  {t(`reports.state.${state}`)}
                </button>
              ))}
            </div>
          )}
          {active.data ? (
            <span className="text-xs text-muted-foreground">
              {t("reports.count", { count: visible.length })}
            </span>
          ) : null}
        </div>
        {body}
      </div>
    </div>
  );
}
