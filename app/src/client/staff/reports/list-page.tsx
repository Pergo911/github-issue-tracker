import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { roleAtLeast } from "@shared/github/roles.ts";
import { usePublicConfig } from "@/config/context.tsx";
import { Alert } from "@/ui/alert.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/ui/button.tsx";
import { staffSession } from "../auth/session.ts";
import { useStaff } from "../auth/staff-context.tsx";
import { Board } from "./board.tsx";
import { moveOptimistically } from "./board-model.ts";
import { patchIssueInCaches } from "./cache.ts";
import { FilterBar } from "./filter-bar.tsx";
import { filterReports, sortByLastReporterComment, sortReports, toReportRow } from "./model.ts";
import { createReportWrites } from "./mutations.ts";
import { reporterCommentsQuery, reportSearchQuery, reportsQuery } from "./queries.ts";
import { ReportListRow } from "./report-row.tsx";
import { listViewToParams, parseListView, type ListView } from "./view-state.ts";

const writes = createReportWrites(staffSession);

function Loading({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 px-4 py-12 text-muted-foreground"
    >
      <span
        aria-hidden="true"
        className="size-5 animate-spin rounded-full border-2 border-border border-t-link motion-reduce:animate-none"
      />
      {text}
    </div>
  );
}

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
  const { repo, bot, role } = useStaff();
  const queryClient = useQueryClient();
  const canMove = roleAtLeast(role, "maintenance");
  const [rolledBack, setRolledBack] = useState<number | null>(null);
  const [pendingCounts, setPendingCounts] = useState<ReadonlyMap<number, number>>(() => new Map());
  const pendingCards = useMemo(() => new Set(pendingCounts.keys()), [pendingCounts]);
  const inFlightMovesRef = useRef(0);
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseListView(params), [params]);
  useDocumentTitle(t("reports.title"), displayName);

  const searching = view.q !== "";
  const all = useQuery({ ...reportsQuery(repo), enabled: !searching });
  const found = useQuery({ ...reportSearchQuery(repo, view.q), enabled: searching });
  const active = searching ? found : all;
  const board = view.layout === "board" && !searching;

  // The Reporter-comment scan (SPEC 2.4): started by the chip, the sort or the check button, never by itself.
  const wantsScan = view.reporter === true || view.sort === "reporter";
  const scanQuery = useQuery({ ...reporterCommentsQuery(repo, bot), enabled: wantsScan });
  const scan = scanQuery.data;
  const scanState = scan
    ? "ready"
    : scanQuery.isError
      ? "error"
      : scanQuery.fetchStatus === "fetching"
        ? "loading"
        : "unknown";
  const scanPending = wantsScan && scan === undefined;

  const rows = useMemo(
    () => (active.data ?? []).map((issue) => toReportRow(issue, taxonomy)),
    [active.data, taxonomy],
  );
  const visible = useMemo(() => {
    const filtered = filterReports(rows, {
      ...view,
      state: searching ? "any" : board ? "open" : view.state,
      reporterComments: view.reporter && scan ? scan : undefined,
    });
    return view.sort === "reporter" && scan
      ? sortByLastReporterComment(filtered, scan)
      : sortReports(filtered, taxonomy);
  }, [rows, view, searching, board, scan, taxonomy]);
  const assignees = useMemo(() => [...new Set(rows.flatMap((row) => row.assignees))], [rows]);
  // The age of a Report is counted from when the list was fetched, so a re-render never changes it.
  const now = active.dataUpdatedAt;

  function adjustPending(number: number, delta: 1 | -1) {
    setPendingCounts((prev) => {
      const next = new Map(prev);
      const count = (next.get(number) ?? 0) + delta;
      if (count > 0) next.set(number, count);
      else next.delete(number);
      return next;
    });
  }

  // A drop and a menu choice are the same write: a fresh GET, then one PATCH of this Report's Status. The card
  // moves at once; on a failure only that card goes back, with a notice. Only the final concurrent move triggers
  // invalidation so an earlier completion never snaps another in-flight card back.
  const move = useMutation({
    mutationKey: ["staff", "reports", "move", repo.owner, repo.name],
    mutationFn: ({ number, status }: { number: number; status: string }) =>
      writes.setDimension(repo, number, "status", status),
    onMutate: async ({ number, status }) => {
      inFlightMovesRef.current += 1;
      adjustPending(number, 1);
      setRolledBack(null);
      const key = reportsQuery(repo).queryKey;
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData(key)?.find((issue) => issue.number === number);
      queryClient.setQueryData(key, (issues) =>
        issues ? moveOptimistically(issues, number, status) : issues,
      );
      return { key, before };
    },
    onSuccess: (updated) => {
      patchIssueInCaches(queryClient, repo, updated);
    },
    onError: (_error, { number }, context) => {
      const { key, before } = context ?? {};
      if (key && before) {
        queryClient.setQueryData(key, (issues) =>
          issues?.map((issue) => (issue.number === number ? before : issue)),
        );
      }
      setRolledBack(number);
    },
    onSettled: (_data, _error, { number }) => {
      adjustPending(number, -1);
      inFlightMovesRef.current = Math.max(0, inFlightMovesRef.current - 1);
      if (inFlightMovesRef.current === 0) {
        return queryClient.invalidateQueries({ queryKey: ["staff", "reports"] });
      }
      return undefined;
    },
  });

  const refresh = () => {
    void active.refetch();
    // A rebuild, so edits and deletions show; a scan that was never asked for stays unrun.
    if (scanQuery.data !== undefined || scanQuery.isError || wantsScan) void scanQuery.refetch();
  };

  const change = (patch: Partial<Record<keyof ListView, string | boolean | undefined>>) => {
    const next = { ...view, ...patch } as Record<string, unknown>;
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    setParams(listViewToParams(next as unknown as ListView, params));
  };

  let body;
  if (active.isPending) {
    body = <Loading text={t("reports.loading")} />;
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
  } else if (scanPending && scanState === "error") {
    body = (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <p className="text-muted-foreground">{t("reports.reporter.error")}</p>
        <Button variant="secondary" onClick={() => void scanQuery.refetch()}>
          {t("boot.retry")}
        </Button>
      </div>
    );
  } else if (scanPending) {
    // Never "none" before the scan completes: the Reports are not known to lack Reporter comments yet.
    body = <Loading text={t("reports.reporter.scanning")} />;
  } else if (board) {
    body = (
      <div className="p-2">
        <Board
          rows={visible}
          taxonomy={taxonomy}
          now={now}
          scan={scan}
          canMove={canMove}
          pendingCards={pendingCards}
          onMove={(number, status) => {
            if (!pendingCards.has(number)) move.mutate({ number, status });
          }}
        />
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
          <ReportListRow key={row.number} row={row} now={now} reporter={scan?.[row.number]} />
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
        refreshing={active.isFetching || scanQuery.fetchStatus === "fetching"}
        scan={scanState}
        onChange={change}
        onRefresh={refresh}
        onCheckReporter={() => void scanQuery.refetch()}
      />
      {rolledBack !== null ? (
        <Alert variant="danger" role="alert">
          <div className="flex w-full items-start justify-between gap-3">
            <p>{t("board.rollback", { number: rolledBack })}</p>
            <button
              type="button"
              className="text-link hover:underline"
              onClick={() => setRolledBack(null)}
            >
              {t("board.dismiss")}
            </button>
          </div>
        </Alert>
      ) : null}
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
            <div role="group" aria-label={t("reports.layout.label")} className="flex gap-1">
              {(["list", "board"] as const).map((layout) => (
                <button
                  key={layout}
                  type="button"
                  aria-pressed={(layout === "board") === board}
                  onClick={() => change({ layout: layout === "board" ? "board" : undefined })}
                  className={cn(
                    "h-7 rounded-md px-3 text-sm hover:bg-accent",
                    (layout === "board") === board && "bg-card font-semibold shadow-resting",
                  )}
                >
                  {t(`reports.layout.${layout}`)}
                </button>
              ))}
            </div>
          )}
          {searching || board ? null : (
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
