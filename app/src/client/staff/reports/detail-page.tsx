import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, SyncIcon } from "@primer/octicons-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import type { Dimension } from "@shared/config/schema.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import { roleAtLeast } from "@shared/github/roles.ts";
import { useFormatter, usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { apiErrorMessage } from "@/api/error-message.ts";
import { Alert } from "@/ui/alert.tsx";
import { Button } from "@/ui/button.tsx";
import { Field, describedBy } from "@/ui/field.tsx";
import { Textarea } from "@/ui/input.tsx";
import { ReportBody } from "@/ui/report-body.tsx";
import { StatePill, type PillState } from "@/ui/state-pill.tsx";
import { StatusTimeline } from "../../reporter/status-timeline.tsx";
import { staffSession } from "../auth/session.ts";
import { useStaff } from "../auth/staff-context.tsx";
import { GitHubHttpError } from "../github/session.ts";
import {
  appendCommentToDetailCache,
  patchIssueInCaches,
  setAssigneeOptimistically,
  setDimensionOptimistically,
} from "./cache.ts";
import { CloseDialog } from "./close-dialog.tsx";
import { toReportDetail, type ReportDetail } from "./detail-model.ts";
import { AssigneeSection, ContactSection, DimensionSection } from "./detail-sidebar.tsx";
import { DuplicateOriginalError, createReportWrites, type CloseChoice } from "./mutations.ts";
import { assignableQuery, reportDetailQuery, reportsQuery } from "./queries.ts";

/** The most a comment may hold after trimming. */
const COMMENT_MAX = 2000;

const writes = createReportWrites(staffSession);

function pillState(detail: ReportDetail): PillState {
  if (detail.row.state === "open") return "open";
  return detail.closeReason === "fixed" ? "fixed" : "rejected";
}

function CommentBox({
  number,
  actions,
}: {
  number: number;
  /** Buttons that sit beside the submit button (close, for Maintenance staff). */
  actions: React.ReactNode;
}) {
  const t = useT();
  const { repo } = useStaff();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: (value: string) => writes.comment(repo, number, value),
    onSuccess: (created) => {
      setText("");
      setSent(true);
      const detailKey = reportDetailQuery(repo, number).queryKey;
      void queryClient.cancelQueries({ queryKey: detailKey });
      appendCommentToDetailCache(queryClient, repo, number, created);
      void queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });
  const length = [...text.trim()].length;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSent(false);
    if (length < 1 || length > COMMENT_MAX) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    send.mutate(text.trim());
  }

  return (
    <section aria-labelledby="comment-heading" className="flex flex-col gap-4">
      <h2 id="comment-heading" className="text-base font-semibold">
        {t("detail.comment.heading")}
      </h2>
      <form
        noValidate
        onSubmit={onSubmit}
        aria-busy={send.isPending}
        className="flex flex-col gap-3"
      >
        {send.isError ? (
          <Alert variant="danger" role="alert">
            <p>{t("detail.error.write")}</p>
          </Alert>
        ) : null}
        {sent && !send.isPending ? (
          <Alert role="status">
            <p>{t("detail.comment.sent")}</p>
          </Alert>
        ) : null}
        <fieldset disabled={send.isPending} className="flex min-w-0 flex-col gap-3 border-0 p-0">
          <Field
            id="comment"
            label={t("detail.comment.label")}
            hint={t("detail.comment.hint")}
            error={invalid ? t("api.error.comment_length") : undefined}
            counter={t("form.counter", { count: length, max: COMMENT_MAX })}
          >
            <Textarea
              rows={4}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setInvalid(false);
              }}
              {...describedBy("comment", { hint: true, error: invalid })}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {actions}
            <Button type="submit">
              {send.isPending ? t("detail.comment.sending") : t("detail.comment.submit")}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

type PendingAction = Dimension | "assignee" | "close" | "reopen";

type WriteAction =
  | { kind: Dimension; id: string }
  | { kind: "assignee"; login: string | null }
  | { kind: "close"; choice: CloseChoice }
  | { kind: "reopen"; initialStatus: string };

function Detail({
  number,
  detail,
  refreshing,
  onRefresh,
}: {
  number: number;
  detail: ReportDetail;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const t = useT();
  const format = useFormatter();
  const { taxonomy } = usePublicConfig();
  const { role, repo } = useStaff();
  const queryClient = useQueryClient();
  const maintenance = roleAtLeast(role, "maintenance");
  const [closing, setClosing] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [duplicateRefused, setDuplicateRefused] = useState(false);
  const initial = taxonomy.status.find((value) => value.initial);

  const closeDialog = () => {
    setClosing(false);
    setDialogKey((key) => key + 1);
  };

  const write = useMutation({
    mutationFn: (action: WriteAction): Promise<GitHubIssue> => {
      switch (action.kind) {
        case "assignee":
          return writes.assign(repo, number, action.login);
        case "close":
          return writes.close(repo, number, action.choice);
        case "reopen":
          return writes.reopen(repo, number, action.initialStatus);
        default:
          return writes.setDimension(repo, number, action.kind, action.id);
      }
    },
    onMutate: async (action) => {
      setDuplicateRefused(false);
      if (action.kind === "close" || action.kind === "reopen") return {};
      const detailKey = reportDetailQuery(repo, number).queryKey;
      const listKey = reportsQuery(repo).queryKey;
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: listKey }),
      ]);
      const previousDetail = queryClient.getQueryData(detailKey);
      const previousList = queryClient.getQueryData(listKey);
      const assignable = queryClient.getQueryData(assignableQuery(repo).queryKey);
      const apply = (issue: GitHubIssue) =>
        action.kind === "assignee"
          ? setAssigneeOptimistically(issue, action.login, assignable)
          : setDimensionOptimistically(issue, action.kind, action.id);

      if (previousDetail) {
        queryClient.setQueryData(detailKey, (current) =>
          current ? { ...current, issue: apply(current.issue) } : current,
        );
      }
      if (previousList) {
        queryClient.setQueryData(listKey, (issues) =>
          issues?.map((issue) => (issue.number === number ? apply(issue) : issue)),
        );
      }
      return { detailKey, listKey, previousDetail, previousList };
    },
    onSuccess: (updated, action) => {
      patchIssueInCaches(queryClient, repo, updated);
      if (action.kind === "close") closeDialog();
    },
    onError: (error, action, context) => {
      if (context?.detailKey && context.previousDetail !== undefined) {
        queryClient.setQueryData(context.detailKey, context.previousDetail);
      }
      if (context?.listKey && context.previousList !== undefined) {
        queryClient.setQueryData(context.listKey, context.previousList);
      }
      if (action.kind === "close") {
        if (error instanceof DuplicateOriginalError) setDuplicateRefused(true);
        closeDialog();
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reportDetailQuery(repo, number).queryKey }),
        queryClient.invalidateQueries({ queryKey: ["staff", "reports"] }),
      ]);
    },
  });
  const closeWith = (choice: CloseChoice) => write.mutate({ kind: "close", choice });

  const { row } = detail;
  const closed = row.state === "closed";
  const comments = detail.timeline.filter((item) => item.kind === "comment").length;
  const stateLabel = closed
    ? t(`status.state.${detail.closeReason ?? "fixed"}`)
    : t("status.state.open");
  const pendingAction: PendingAction | null = write.isPending
    ? (write.variables?.kind ?? null)
    : null;
  const busy = pendingAction !== null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/staff/reports"
          className="inline-flex w-fit items-center gap-1 text-sm text-link hover:underline"
        >
          <ArrowLeftIcon size={16} aria-hidden="true" />
          {t("detail.back")}
        </Link>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <SyncIcon size={16} aria-hidden="true" />
          {refreshing ? t("reports.refreshing") : t("reports.refresh")}
        </Button>
      </div>
      <header className="flex flex-col gap-3 border-b border-border-subtle pb-3">
        <h1 className="text-[26px] leading-tight font-normal break-words md:text-[32px]">
          {row.title} <span className="text-muted-foreground">#{row.number}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatePill state={pillState(detail)} label={stateLabel} />
          <p className="text-xs text-muted-foreground">
            {t("status.meta.opened", { date: format.dateTime(row.createdAt) })}
            {" · "}
            {closed && detail.closedAt
              ? t("status.meta.closed", { date: format.dateTime(detail.closedAt) })
              : t("status.meta.updated", { date: format.dateTime(detail.updatedAt) })}
          </p>
        </div>
      </header>

      {row.statusProblem ? (
        <Alert variant="attention" role="status">
          <p className="font-semibold">{t(`reports.statusProblem.${row.statusProblem}`)}</p>
          {maintenance ? <p>{t("detail.statusProblem.hint")}</p> : null}
        </Alert>
      ) : null}
      {write.isError ? (
        <Alert variant="danger" role="alert">
          <p>{duplicateRefused ? t("detail.close.originalInvalid") : t("detail.error.write")}</p>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <ReportBody body={detail.body} />
          <section aria-labelledby="history-heading" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="history-heading" className="text-base font-semibold">
                {t("status.history.heading")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("status.comments.count", { count: comments })}
              </p>
            </div>
            {detail.timeline.length > 0 ? (
              <StatusTimeline items={detail.timeline} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("status.comments.empty")}</p>
            )}
          </section>
          <CommentBox
            number={number}
            actions={
              maintenance ? (
                closed ? (
                  <Button
                    variant="secondary"
                    disabled={busy || initial === undefined}
                    onClick={() =>
                      initial && write.mutate({ kind: "reopen", initialStatus: initial.id })
                    }
                  >
                    {pendingAction === "reopen"
                      ? t("detail.reopen.reopening")
                      : t("detail.reopen.button")}
                  </Button>
                ) : (
                  <Button variant="secondary" disabled={busy} onClick={() => setClosing(true)}>
                    {t("detail.close.button")}
                  </Button>
                )
              ) : null
            }
          />
        </div>

        <aside className="order-first flex flex-col gap-4 lg:order-last">
          {(
            ["status", "category", "location", "priority"] as const satisfies readonly Dimension[]
          ).map((dimension) => (
            <DimensionSection
              key={dimension}
              detail={detail}
              dimension={dimension}
              taxonomy={taxonomy}
              editable={maintenance && !(dimension === "status" && closed)}
              busy={busy}
              saving={pendingAction === dimension}
              onChange={(id) => write.mutate({ kind: dimension, id })}
            />
          ))}
          <AssigneeSection
            detail={detail}
            repo={repo}
            editable={maintenance}
            busy={busy}
            saving={pendingAction === "assignee"}
            onChange={(login) => write.mutate({ kind: "assignee", login })}
          />
          {maintenance ? <ContactSection number={number} /> : null}
        </aside>
      </div>

      {maintenance ? (
        <CloseDialog
          key={dialogKey}
          open={closing}
          busy={pendingAction === "close"}
          onClose={closeDialog}
          onConfirm={closeWith}
        />
      ) : null}
    </div>
  );
}

/** The Detail view (SPEC 2.4): one Report, its timeline and, for Maintenance staff, the controls. Lazy-loaded. */
export function Component() {
  const t = useT();
  const { displayName, taxonomy } = usePublicConfig();
  const { repo, bot } = useStaff();
  const { number: raw = "" } = useParams();
  const number = /^\d+$/.test(raw) ? Number(raw) : 0;
  const query = useQuery({ ...reportDetailQuery(repo, number), enabled: number > 0 });
  const detail = useMemo(
    () =>
      query.data ? toReportDetail(query.data.issue, query.data.timeline, taxonomy, bot) : null,
    [query.data, taxonomy, bot],
  );
  useDocumentTitle(t("detail.title", { number }), displayName);

  const notFound =
    number === 0 || (query.error instanceof GitHubHttpError && query.error.status === 404);
  if (notFound) {
    return (
      <div className="flex max-w-2xl flex-col items-start gap-4">
        <h1 className="text-xl font-semibold">{t("detail.notFound.title")}</h1>
        <p className="text-muted-foreground">{t("detail.notFound.description")}</p>
        <Link to="/staff/reports" className="text-link hover:underline">
          {t("detail.back")}
        </Link>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex max-w-2xl flex-col items-start gap-4">
        <h1 className="text-xl font-semibold">{t("detail.error.title")}</h1>
        <Alert variant="danger" role="alert">
          <p>{apiErrorMessage(t, query.error)}</p>
        </Alert>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t("boot.retry")}
        </Button>
      </div>
    );
  }
  if (detail === null) {
    return (
      <p role="status" className="text-muted-foreground">
        {t("detail.loading")}
      </p>
    );
  }
  return (
    <Detail
      number={number}
      detail={detail}
      refreshing={query.isFetching}
      onRefresh={() => void query.refetch()}
    />
  );
}
