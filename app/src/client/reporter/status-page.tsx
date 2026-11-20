import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { endpoints } from "@shared/api/endpoints.ts";
import type { PublicConfig } from "@shared/config/public.ts";
import type { StatusView } from "@shared/status/view.ts";
import { ApiError, callApi } from "@/api/call-api.ts";
import { apiErrorMessage } from "@/api/error-message.ts";
import { useFormatter, usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { Alert } from "@/ui/alert.tsx";
import { BackToHome } from "@/ui/back-to-home.tsx";
import { Button } from "@/ui/button.tsx";
import { ConfirmDialog } from "@/ui/dialog.tsx";
import { Field, describedBy } from "@/ui/field.tsx";
import { Textarea } from "@/ui/input.tsx";
import { LabelPill } from "@/ui/label-pill.tsx";
import { ReportBody } from "@/ui/report-body.tsx";
import { StatePill, type PillState } from "@/ui/state-pill.tsx";
import { StatusTimeline } from "./status-timeline.tsx";

/** The most a comment may hold after trimming (SPEC 4.3, 4.5). */
const COMMENT_MAX = 2000;

type Taxonomy = PublicConfig["taxonomy"];

const statusQuery = (token: string) => ({
  queryKey: ["status", token],
  queryFn: () => callApi(endpoints.statusLookup, { token }),
  // The page is a read-only proxy of GitHub: a refresh loop must not spend the Bot's quota, and a limit or a
  // 404 is an answer, not a reason to ask again.
  retry: false,
  staleTime: 30_000,
  refetchOnWindowFocus: false,
});

function pillState(view: StatusView): PillState {
  if (view.state === "open") return "open";
  return view.closeReason === "fixed" ? "fixed" : "rejected";
}

function ValuePill({
  taxonomy,
  dimension,
  id,
}: {
  taxonomy: Taxonomy;
  dimension: "status" | "category" | "location";
  id: string | null;
}) {
  const value = id === null ? undefined : taxonomy[dimension].find((entry) => entry.id === id);
  return value ? <LabelPill text={value.name} color={value.color ?? null} /> : null;
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border-subtle pb-4 last:border-b-0">
      <h2 className="text-xs font-semibold text-muted-foreground">{title}</h2>
      <div className="flex flex-wrap gap-2 text-sm">{children}</div>
    </div>
  );
}

function CommentBox({ token, closed }: { token: string; closed: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [sent, setSent] = useState(false);

  const send = useMutation({
    mutationFn: (value: string) => callApi(endpoints.statusComment, { token, text: value }),
    onSuccess: async () => {
      setText("");
      setSent(true);
      await queryClient.invalidateQueries({ queryKey: ["status", token] });
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
        {t("status.comment.heading")}
      </h2>
      {closed ? (
        <Alert variant="attention" title={t("status.closedNotice.title")}>
          <p>{t("status.closedNotice.description")}</p>
        </Alert>
      ) : null}
      <form
        noValidate
        onSubmit={onSubmit}
        aria-busy={send.isPending}
        className="flex flex-col gap-3"
      >
        {send.isError ? (
          <Alert variant="danger" role="alert">
            <p>{apiErrorMessage(t, send.error)}</p>
          </Alert>
        ) : null}
        {sent && !send.isPending ? (
          <Alert role="status">
            <p>{t("status.comment.sent")}</p>
          </Alert>
        ) : null}
        <fieldset disabled={send.isPending} className="flex min-w-0 flex-col gap-3 border-0 p-0">
          <Field
            id="comment"
            label={t("status.comment.label")}
            hint={t("status.comment.hint")}
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
          <div>
            <Button type="submit">
              {send.isPending ? t("status.comment.sending") : t("status.comment.submit")}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

function ReissueSection({ token, onDone }: { token: string; onDone: () => void }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const reissue = useMutation({
    mutationFn: () => callApi(endpoints.statusReissue, { token }),
    onSuccess: () => {
      setConfirming(false);
      onDone();
    },
    onError: () => setConfirming(false),
  });
  return (
    <section aria-labelledby="reissue-heading" className="flex flex-col gap-3 border-t pt-6">
      <h2 id="reissue-heading" className="text-base font-semibold">
        {t("status.reissue.heading")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("status.reissue.description")}</p>
      {reissue.isError ? (
        <Alert variant="danger" role="alert">
          <p>{apiErrorMessage(t, reissue.error)}</p>
        </Alert>
      ) : null}
      <div>
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          {t("status.reissue.button")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={t("status.reissue.confirm.title")}
        description={t("status.reissue.confirm.description")}
        confirmLabel={
          reissue.isPending ? t("status.reissue.sending") : t("status.reissue.confirm.accept")
        }
        cancelLabel={t("status.reissue.confirm.cancel")}
        busy={reissue.isPending}
        onConfirm={() => reissue.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}

function Reissued() {
  const t = useT();
  return (
    <div className="flex max-w-2xl flex-col items-start gap-4">
      <h1 className="text-xl font-semibold">{t("status.reissued.title")}</h1>
      <p role="status" className="text-muted-foreground">
        {t("status.reissued.description")}
      </p>
      <BackToHome />
    </div>
  );
}

function NotFoundLink() {
  const t = useT();
  return (
    <div className="flex max-w-2xl flex-col items-start gap-4">
      <h1 className="text-xl font-semibold">{t("status.notFound.title")}</h1>
      <p className="text-muted-foreground">{t("status.notFound.description")}</p>
      <BackToHome />
    </div>
  );
}

function Report({ view, token }: { view: StatusView; token: string }) {
  const t = useT();
  const format = useFormatter();
  const { taxonomy } = usePublicConfig();
  const [reissued, setReissued] = useState(false);
  const queryClient = useQueryClient();
  const comments = view.timeline.filter((item) => item.kind === "comment").length;

  useEffect(() => {
    // Reporters never leave this page through a link that carries the token elsewhere.
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.append(meta);
    return () => meta.remove();
  }, []);

  if (reissued) return <Reissued />;
  const stateLabel =
    view.state === "open"
      ? t("status.state.open")
      : t(`status.state.${view.closeReason ?? "fixed"}`);
  const closed = view.state === "closed";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border-subtle pb-3">
        <h1 className="text-[26px] leading-tight font-normal break-words md:text-[32px]">
          {view.title} <span className="text-muted-foreground">#{view.number}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatePill state={pillState(view)} label={stateLabel} />
          <p className="text-xs text-muted-foreground">
            {t("status.meta.opened", { date: format.dateTime(view.createdAt) })}
            {" · "}
            {closed && view.closedAt
              ? t("status.meta.closed", { date: format.dateTime(view.closedAt) })
              : t("status.meta.updated", { date: format.dateTime(view.updatedAt) })}
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <ReportBody body={view.body} />
          <section aria-labelledby="history-heading" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="history-heading" className="text-base font-semibold">
                {t("status.history.heading")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("status.comments.count", { count: comments })}
              </p>
            </div>
            {view.timeline.length > 0 ? (
              <StatusTimeline items={view.timeline} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("status.comments.empty")}</p>
            )}
          </section>
          <CommentBox token={token} closed={closed} />
        </div>

        <aside className="order-first flex flex-col gap-4 lg:order-last">
          <SidebarSection title={t("status.sidebar.status")}>
            {closed ? (
              <span>{stateLabel}</span>
            ) : view.status === null ? (
              <LabelPill text={t("status.awaiting")} color={null} />
            ) : (
              <ValuePill taxonomy={taxonomy} dimension="status" id={view.status} />
            )}
          </SidebarSection>
          <SidebarSection title={t("status.sidebar.category")}>
            <ValuePill taxonomy={taxonomy} dimension="category" id={view.category} />
          </SidebarSection>
          <SidebarSection title={t("status.sidebar.location")}>
            <ValuePill taxonomy={taxonomy} dimension="location" id={view.location} />
          </SidebarSection>
          <SidebarSection title={t("status.sidebar.assignment")}>
            <span>{view.assigned ? t("status.assigned") : t("status.unassigned")}</span>
          </SidebarSection>
        </aside>
      </div>

      <ReissueSection
        token={token}
        onDone={() => {
          queryClient.removeQueries({ queryKey: ["status", token] });
          setReissued(true);
        }}
      />
    </div>
  );
}

/** The Status page (SPEC 4.3): `/status/<token>`, with no login. Lazy-loaded. */
export function Component() {
  const t = useT();
  const { displayName } = usePublicConfig();
  const { token = "" } = useParams();
  const query = useQuery(statusQuery(token));
  const notFound = query.error instanceof ApiError && query.error.code === "not_found";

  useDocumentTitle(
    query.data ? t("status.title", { number: query.data.number }) : t("status.notFound.title"),
    displayName,
  );

  if (query.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {t("status.loading")}
      </p>
    );
  }
  if (notFound) return <NotFoundLink />;
  if (query.isError) {
    return (
      <div className="flex max-w-2xl flex-col items-start gap-4">
        <h1 className="text-xl font-semibold">{t("status.error.title")}</h1>
        <Alert variant="danger" role="alert">
          <p>{apiErrorMessage(t, query.error)}</p>
        </Alert>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t("boot.retry")}
        </Button>
      </div>
    );
  }
  return <Report view={query.data} token={token} />;
}
