import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
import { endpoints } from "@shared/api/endpoints.ts";
import type { Dimension } from "@shared/config/schema.ts";
import type { PublicConfig } from "@shared/config/public.ts";
import { callApi } from "@/api/call-api.ts";
import { apiErrorMessage } from "@/api/error-message.ts";
import { useT } from "@/i18n/context.tsx";
import { Alert } from "@/ui/alert.tsx";
import { Button } from "@/ui/button.tsx";
import { ConfirmDialog } from "@/ui/dialog.tsx";
import { LabelPill } from "@/ui/label-pill.tsx";
import { Picker } from "@/ui/picker.tsx";
import { staffSession } from "../auth/session.ts";
import type { ReportDetail } from "./detail-model.ts";
import { assignableQuery } from "./queries.ts";

type Taxonomy = PublicConfig["taxonomy"];
type Repo = { owner: string; name: string };

export function SidebarSection({
  title,
  id,
  saving = false,
  children,
}: {
  title: string;
  id?: string;
  saving?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div
      aria-busy={saving || undefined}
      className="flex flex-col gap-2 border-b border-border-subtle pb-4 last:border-b-0"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="text-xs font-semibold text-muted-foreground">
          {title}
        </h2>
        {saving ? (
          <span
            role="status"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            data-sidebar-saving=""
          >
            <span
              aria-hidden="true"
              className="size-3 animate-spin rounded-full border-2 border-border border-t-link motion-reduce:animate-none"
            />
            {t("detail.sidebar.saving")}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">{children}</div>
    </div>
  );
}

const SECTION_TITLE = {
  status: "status.sidebar.status",
  category: "status.sidebar.category",
  location: "status.sidebar.location",
  priority: "detail.sidebar.priority",
} as const;

/** The pills of a dimension that the Report wears: the configured value, or an unknown label by its raw name. */
function Pills({
  detail,
  dimension,
  unknownOnly = false,
}: {
  detail: ReportDetail;
  dimension: Dimension;
  unknownOnly?: boolean;
}) {
  const pills = detail.row.pills.filter(
    (pill) => pill.dimension === dimension && (!unknownOnly || pill.unknown),
  );
  return pills.map((pill) => <LabelPill key={pill.text} text={pill.text} color={pill.color} />);
}

/**
 * One classification dimension in the sidebar: the Report's pills for a Viewer, and for Maintenance staff a picker
 * over the configured values (SPEC 2.4). The caller makes the write.
 */
export function DimensionSection({
  detail,
  dimension,
  taxonomy,
  editable,
  busy,
  saving = false,
  onChange,
}: {
  detail: ReportDetail;
  dimension: Dimension;
  taxonomy: Taxonomy;
  editable: boolean;
  busy: boolean;
  saving?: boolean;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const title = t(SECTION_TITLE[dimension]);
  const headingId = useId();
  const closedStatus = dimension === "status" && detail.row.state === "closed";
  if (closedStatus) {
    return (
      <SidebarSection title={title}>
        <span>{t(`status.state.${detail.closeReason ?? "fixed"}`)}</span>
      </SidebarSection>
    );
  }
  return (
    <SidebarSection title={title} id={headingId} saving={saving}>
      {editable ? (
        <div className="w-full">
          <Picker
            labelledBy={headingId}
            value={detail.row[dimension]}
            placeholder={t("detail.picker.unset")}
            disabled={busy}
            options={taxonomy[dimension].map((value) => ({ value: value.id, label: value.name }))}
            onChange={onChange}
          />
        </div>
      ) : null}
      {/* The picker cannot show an unknown label, so it stays visible beside it: nothing the Report wears is hidden. */}
      <Pills detail={detail} dimension={dimension} unknownOnly={editable} />
      {!editable && detail.row.pills.every((pill) => pill.dimension !== dimension) ? (
        <span className="text-muted-foreground">{t("detail.picker.unset")}</span>
      ) : null}
    </SidebarSection>
  );
}

const NO_ONE = "";

/** The assignee: the logins for a Viewer, a picker over the members who can be assigned for Maintenance staff. */
export function AssigneeSection({
  detail,
  repo,
  editable,
  busy,
  saving = false,
  onChange,
}: {
  detail: ReportDetail;
  repo: Repo;
  editable: boolean;
  busy: boolean;
  saving?: boolean;
  onChange: (login: string | null) => void;
}) {
  const t = useT();
  const title = t("detail.sidebar.assignee");
  const headingId = useId();
  const members = useQuery({ ...assignableQuery(repo), enabled: editable });
  const current = detail.row.assignees[0] ?? null;
  if (!editable) {
    return (
      <SidebarSection title={title}>
        <span>
          {detail.row.assignees.length > 0
            ? detail.row.assignees.join(", ")
            : t("detail.picker.unassigned")}
        </span>
      </SidebarSection>
    );
  }
  const logins = [
    ...new Set([...(members.data ?? []).map((user) => user.login), ...detail.row.assignees]),
  ];
  return (
    <SidebarSection title={title} id={headingId} saving={saving}>
      <div className="w-full">
        <Picker
          labelledBy={headingId}
          value={current ?? NO_ONE}
          placeholder={
            members.isPending ? t("detail.picker.loading") : t("detail.picker.unassigned")
          }
          disabled={busy || members.isPending}
          options={[
            { value: NO_ONE, label: t("detail.picker.unassigned") },
            ...logins.map((login) => ({ value: login, label: login })),
          ]}
          onChange={(login) => onChange(login === NO_ONE ? null : login)}
        />
      </div>
    </SidebarSection>
  );
}

/**
 * Reveal-contact and the Staff Reissue (SPEC 4.3, 4.4), for Maintenance staff: the contact appears only on
 * demand, and the Worker checks the role again. The new link after a Reissue is never shown, only mailed.
 */
export function ContactSection({ number }: { number: number }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const reveal = useMutation({
    mutationFn: () =>
      staffSession.withToken((token) =>
        callApi(endpoints.revealContact, { issueNumber: number }, { token }),
      ),
  });
  const reissue = useMutation({
    mutationFn: () =>
      staffSession.withToken((token) =>
        callApi(endpoints.staffReissue, { issueNumber: number }, { token }),
      ),
    onSuccess: () => {
      // What was revealed is out of date now: the link it showed has stopped working.
      reveal.reset();
      setConfirming(false);
    },
    onError: () => setConfirming(false),
  });
  const contact = reveal.data;

  return (
    <SidebarSection title={t("detail.contact.heading")}>
      <div className="flex w-full flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t("detail.contact.description")}</p>
        {reveal.isError ? (
          <Alert variant="danger" role="alert">
            <p>{apiErrorMessage(t, reveal.error)}</p>
          </Alert>
        ) : null}
        {contact ? (
          <dl
            className="flex flex-col gap-2 rounded-md border bg-muted p-3 text-sm"
            data-contact=""
          >
            <div>
              <dt className="text-xs font-semibold text-muted-foreground">
                {t("detail.contact.email")}
              </dt>
              <dd className="break-all">{contact.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted-foreground">
                {t("detail.contact.link")}
              </dt>
              <dd className="break-all">{contact.statusUrl ?? t("detail.contact.noLink")}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted-foreground">
                {t("detail.contact.note")}
              </dt>
              <dd className="break-words">
                {contact.allowlist === null
                  ? t("detail.contact.unlisted")
                  : (contact.allowlist.note ?? t("detail.contact.noNote"))}
              </dd>
            </div>
          </dl>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {contact ? (
            <Button variant="secondary" size="sm" onClick={() => reveal.reset()}>
              {t("detail.contact.hide")}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={reveal.isPending}
              onClick={() => reveal.mutate()}
            >
              {reveal.isPending ? t("detail.contact.loading") : t("detail.contact.show")}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            {t("detail.reissue.button")}
          </Button>
        </div>
        {reissue.isError ? (
          <Alert variant="danger" role="alert">
            <p>{apiErrorMessage(t, reissue.error)}</p>
          </Alert>
        ) : null}
        {reissue.isSuccess ? (
          <Alert role="status">
            <p>{t("detail.reissue.done")}</p>
          </Alert>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming}
        title={t("detail.reissue.title")}
        description={t("detail.reissue.description")}
        confirmLabel={reissue.isPending ? t("detail.reissue.sending") : t("detail.reissue.accept")}
        cancelLabel={t("detail.reissue.cancel")}
        busy={reissue.isPending}
        onConfirm={() => reissue.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </SidebarSection>
  );
}
