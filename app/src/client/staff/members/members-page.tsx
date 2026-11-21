import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { endpoints } from "@shared/api/endpoints.ts";
import { STAFF_ROLES, type StaffRole } from "@shared/github/roles.ts";
import type { StaffInvitation, StaffMember } from "@shared/staff/members.ts";
import { ApiError } from "@/api/call-api.ts";
import { apiErrorMessage } from "@/api/error-message.ts";
import { useFormatter, usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { Alert } from "@/ui/alert.tsx";
import { Button } from "@/ui/button.tsx";
import { Field, describedBy } from "@/ui/field.tsx";
import { Input, Select } from "@/ui/input.tsx";
import { callAsStaff } from "../admin/call.ts";
import { RequireAdmin } from "../admin/require-admin.tsx";
import { Loading } from "../admin/spinner.tsx";

const membersQuery = {
  queryKey: ["staff", "members"],
  queryFn: () => callAsStaff(endpoints.staffMembersList, {}),
  retry: false,
  refetchOnMount: "always",
} as const;

type OverrideNotice =
  | { kind: "downgrade"; login: string; effectiveRole: StaffRole }
  | { kind: "remove"; login: string; effectiveRole: StaffRole };

type AddNotice = { kind: "added" | "invited"; login: string; role: StaffRole };

function isPermissionRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === "staff_permission_required";
}

function visibleError(error: unknown, isError: boolean): unknown {
  return isError && !isPermissionRequired(error) ? error : undefined;
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: membersQuery.queryKey });
}

function RoleOptions() {
  const t = useT();
  return (
    <>
      {STAFF_ROLES.map((role) => (
        <option key={role} value={role}>
          {t(`staff.role.${role}`)}
        </option>
      ))}
    </>
  );
}

function PermissionRequiredBanner({ onRetry }: { onRetry?: () => void }) {
  const t = useT();
  return (
    <Alert variant="attention" role="alert" title={t("members.permissionRequired.title")}>
      <p>{t("members.permissionRequired.description")}</p>
      {onRetry ? (
        <div className="mt-2">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t("boot.retry")}
          </Button>
        </div>
      ) : null}
    </Alert>
  );
}

function InlineRoleEditor({
  id,
  label,
  currentRole,
  value,
  pending,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  id: string;
  label: string;
  currentRole: StaffRole;
  value: StaffRole;
  pending: boolean;
  error: unknown;
  onChange: (role: StaffRole) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const unchanged = value === currentRole;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!unchanged) onSave();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select
        id={id}
        className="w-auto min-w-36"
        value={value}
        onChange={(event) => onChange(event.target.value as StaffRole)}
      >
        <RoleOptions />
      </Select>
      <Button type="submit" size="sm" disabled={pending || unchanged}>
        {pending ? t("members.role.saving") : t("members.role.save")}
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
        {t("members.role.cancel")}
      </Button>
      {error !== undefined ? (
        <p className="w-full text-xs font-medium text-danger">{apiErrorMessage(t, error)}</p>
      ) : null}
    </form>
  );
}

function InlineDangerConfirm({
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel: string;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <Alert variant="danger" role="alert" title={title}>
      <p>{description}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="destructive" size="sm" disabled={pending} onClick={onConfirm}>
          {pending ? pendingLabel : confirmLabel}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
      {error !== undefined ? (
        <p className="font-medium text-danger">{apiErrorMessage(t, error)}</p>
      ) : null}
    </Alert>
  );
}

function AddMember({ onMutationError }: { onMutationError: (error: unknown) => void }) {
  const t = useT();
  const refresh = useRefresh();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<StaffRole>("viewer");
  const [notice, setNotice] = useState<AddNotice | null>(null);

  const add = useMutation({
    mutationFn: () => callAsStaff(endpoints.staffMemberAdd, { username, role }),
    onSuccess: async (result) => {
      setUsername("");
      if (result.outcome === "added") {
        setNotice({ kind: "added", login: result.member.login, role: result.member.role });
      } else {
        setNotice({
          kind: "invited",
          login: result.invitation.login,
          role: result.invitation.role,
        });
      }
      await refresh();
    },
    onError: onMutationError,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    add.mutate();
  };

  const error = visibleError(add.error, add.isError);
  const fieldError = error !== undefined ? apiErrorMessage(t, error) : undefined;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <h2 className="text-base font-semibold">{t("members.add.title")}</h2>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field
          id="staff-username"
          label={t("members.add.username")}
          hint={t("members.add.usernameHint")}
          error={fieldError}
        >
          <Input
            {...describedBy("staff-username", { hint: true, error: fieldError !== undefined })}
            autoComplete="off"
            spellCheck={false}
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              add.reset();
            }}
            required
          />
        </Field>
        <Field id="staff-role" label={t("members.add.role")}>
          <Select
            id="staff-role"
            value={role}
            onChange={(event) => setRole(event.target.value as StaffRole)}
          >
            <RoleOptions />
          </Select>
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? t("members.add.submitting") : t("members.add.submit")}
        </Button>
      </div>
      {notice ? (
        <Alert
          variant="neutral"
          role="status"
          title={t(
            notice.kind === "added" ? "members.add.added.title" : "members.add.invited.title",
          )}
        >
          <p>
            {t(
              notice.kind === "added"
                ? "members.add.added.description"
                : "members.add.invited.description",
              { login: notice.login },
            )}
          </p>
          <p>
            {t("members.add.assignedRole")}{" "}
            <strong className="font-semibold">{t(`staff.role.${notice.role}`)}</strong>
          </p>
        </Alert>
      ) : null}
    </form>
  );
}

function MemberRow({
  member,
  adminCount,
  onOverride,
  onMutationError,
}: {
  member: StaffMember;
  adminCount: number;
  onOverride: (notice: OverrideNotice) => void;
  onMutationError: (error: unknown) => void;
}) {
  const t = useT();
  const refresh = useRefresh();
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const [selectedRole, setSelectedRole] = useState<StaffRole>(member.role);

  const isLastAdmin = member.role === "admin" && adminCount <= 1;
  const canModify = !member.isSelf && member.managed && !isLastAdmin;

  const save = useMutation({
    mutationFn: () =>
      callAsStaff(endpoints.staffMemberRole, { username: member.login, role: selectedRole }),
    onSuccess: async (result) => {
      if (result.overridden) {
        onOverride({
          kind: "downgrade",
          login: result.member.login,
          effectiveRole: result.member.role,
        });
      }
      await refresh();
      setMode((current) => (current === "edit" ? "view" : current));
    },
    onError: onMutationError,
  });

  const remove = useMutation({
    mutationFn: () => callAsStaff(endpoints.staffMemberRemove, { username: member.login }),
    onSuccess: async (result) => {
      if (result.overridden && result.effectiveRole !== null) {
        onOverride({
          kind: "remove",
          login: member.login,
          effectiveRole: result.effectiveRole,
        });
      }
      await refresh();
      setMode((current) => (current === "remove" ? "view" : current));
    },
    onError: onMutationError,
  });

  const guardKey =
    member.isSelf && isLastAdmin
      ? ("members.guard.selfAndLastAdmin" as const)
      : member.isSelf
        ? ("members.guard.self" as const)
        : !member.managed
          ? ("members.guard.inherited" as const)
          : ("members.guard.lastAdmin" as const);

  return (
    <li
      className="flex flex-col gap-2 border-t border-border-subtle px-4 py-3 first:border-t-0"
      data-staff-member={member.login}
    >
      <div className="grid items-start gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.8fr)_17.5rem] md:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-all">{member.login}</span>
          {member.isSelf ? (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {t("members.badge.self")}
            </span>
          ) : null}
          {!member.managed ? (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {t("members.badge.inherited")}
            </span>
          ) : null}
        </div>
        {mode === "edit" ? (
          <InlineRoleEditor
            id={`member-role-${member.login}`}
            label={t("members.role.label", { login: member.login })}
            currentRole={member.role}
            value={selectedRole}
            pending={save.isPending}
            error={visibleError(save.error, save.isError)}
            onChange={(next) => {
              setSelectedRole(next);
              save.reset();
            }}
            onSave={() => save.mutate()}
            onCancel={() => {
              setSelectedRole(member.role);
              save.reset();
              setMode("view");
            }}
          />
        ) : (
          <span className="text-sm">{t(`staff.role.${member.role}`)}</span>
        )}
        {canModify ? (
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Button
              variant="secondary"
              size="sm"
              aria-label={`${t("members.role.edit")}: ${member.login}`}
              onClick={() => {
                setSelectedRole(member.role);
                save.reset();
                setMode("edit");
              }}
            >
              {t("members.role.edit")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-label={`${t("members.remove")}: ${member.login}`}
              onClick={() => {
                remove.reset();
                setMode("remove");
              }}
            >
              {t("members.remove")}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground md:max-w-xs md:text-right">{t(guardKey)}</p>
        )}
      </div>
      {mode === "remove" ? (
        <InlineDangerConfirm
          title={t("members.remove.title", { login: member.login })}
          description={t("members.remove.description")}
          confirmLabel={t("members.remove.confirm")}
          pendingLabel={t("members.remove.removing")}
          cancelLabel={t("members.remove.cancel")}
          pending={remove.isPending}
          error={visibleError(remove.error, remove.isError)}
          onConfirm={() => remove.mutate()}
          onCancel={() => {
            remove.reset();
            setMode("view");
          }}
        />
      ) : null}
    </li>
  );
}

function InvitationRow({
  invitation,
  onMutationError,
}: {
  invitation: StaffInvitation;
  onMutationError: (error: unknown) => void;
}) {
  const t = useT();
  const format = useFormatter();
  const refresh = useRefresh();
  const [mode, setMode] = useState<"view" | "edit" | "cancel">("view");
  const [selectedRole, setSelectedRole] = useState<StaffRole>(invitation.role);

  const save = useMutation({
    mutationFn: () =>
      callAsStaff(endpoints.staffInvitationRole, {
        invitationId: invitation.id,
        role: selectedRole,
      }),
    onSuccess: async () => {
      await refresh();
      setMode((current) => (current === "edit" ? "view" : current));
    },
    onError: onMutationError,
  });

  const cancel = useMutation({
    mutationFn: () => callAsStaff(endpoints.staffInvitationCancel, { invitationId: invitation.id }),
    onSuccess: refresh,
    onError: onMutationError,
  });

  const meta = invitation.invitedBy
    ? t("members.invitations.meta", {
        login: invitation.invitedBy,
        date: format.date(invitation.createdAt),
      })
    : t("members.invitations.metaDateOnly", { date: format.date(invitation.createdAt) });

  return (
    <li
      className="flex flex-col gap-2 border-t border-border-subtle px-4 py-3 first:border-t-0"
      data-staff-invitation={invitation.id}
      data-invitation-login={invitation.login}
    >
      <div className="grid items-start gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.8fr)_auto] md:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-all">{invitation.login}</span>
          {invitation.expired ? (
            <span className="rounded-full border border-attention bg-attention-muted px-2 py-0.5 text-xs font-medium text-attention">
              {t("members.invitations.expired")}
            </span>
          ) : null}
        </div>
        {mode === "edit" ? (
          <InlineRoleEditor
            id={`invitation-role-${invitation.id}`}
            label={t("members.invitations.roleLabel", { login: invitation.login })}
            currentRole={invitation.role}
            value={selectedRole}
            pending={save.isPending}
            error={visibleError(save.error, save.isError)}
            onChange={(next) => {
              setSelectedRole(next);
              save.reset();
            }}
            onSave={() => save.mutate()}
            onCancel={() => {
              setSelectedRole(invitation.role);
              save.reset();
              setMode("view");
            }}
          />
        ) : (
          <span className="text-sm">{t(`staff.role.${invitation.role}`)}</span>
        )}
        <span className="text-sm text-muted-foreground">{meta}</span>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${t("members.invitations.edit")}: ${invitation.login}`}
            onClick={() => {
              setSelectedRole(invitation.role);
              save.reset();
              setMode("edit");
            }}
          >
            {t("members.invitations.edit")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${t("members.invitations.cancel")}: ${invitation.login}`}
            onClick={() => {
              cancel.reset();
              setMode("cancel");
            }}
          >
            {t("members.invitations.cancel")}
          </Button>
        </div>
      </div>
      {mode === "cancel" ? (
        <InlineDangerConfirm
          title={t("members.invitations.cancelTitle", { login: invitation.login })}
          description={t("members.invitations.cancelDescription")}
          confirmLabel={t("members.invitations.cancelConfirm")}
          pendingLabel={t("members.invitations.cancelling")}
          cancelLabel={t("members.invitations.keep")}
          pending={cancel.isPending}
          error={visibleError(cancel.error, cancel.isError)}
          onConfirm={() => cancel.mutate()}
          onCancel={() => {
            cancel.reset();
            setMode("view");
          }}
        />
      ) : null}
    </li>
  );
}

/**
 * The Staff screen (SPEC 2.4, ADR 0006), System admin only: add a single Staff member by GitHub username,
 * view and edit direct repository roles, inspect read-only inherited GitHub Organization or team grants,
 * and manage pending outside-collaborator Staff invitations.
 */
export function Component() {
  const t = useT();
  const { displayName } = usePublicConfig();
  useDocumentTitle(t("members.title"), displayName);

  const list = useQuery(membersQuery);
  const [overrideNotice, setOverrideNotice] = useState<OverrideNotice | null>(null);
  const [mutationPermissionError, setMutationPermissionError] = useState(false);

  const handleMutationError = (error: unknown) => {
    if (isPermissionRequired(error)) setMutationPermissionError(true);
  };

  const listPermissionError = list.isError && isPermissionRequired(list.error);
  const members = list.data?.members ?? [];
  const invitations = list.data?.invitations ?? [];
  const adminCount = members.filter((member) => member.role === "admin").length;

  let content;
  if (list.isPending) {
    content = (
      <div className="overflow-hidden rounded-md border">
        <Loading text={t("members.loading")} />
      </div>
    );
  } else if (listPermissionError) {
    content = (
      <PermissionRequiredBanner
        onRetry={() => {
          setMutationPermissionError(false);
          void list.refetch();
        }}
      />
    );
  } else if (list.isError) {
    content = (
      <div className="overflow-hidden rounded-md border">
        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
          <h2 className="text-base font-semibold">{t("members.error.title")}</h2>
          <p className="text-muted-foreground">{apiErrorMessage(t, list.error)}</p>
          <Button variant="secondary" onClick={() => void list.refetch()}>
            {t("boot.retry")}
          </Button>
        </div>
      </div>
    );
  } else {
    content = (
      <>
        {mutationPermissionError ? (
          <PermissionRequiredBanner
            onRetry={() => {
              setMutationPermissionError(false);
              void list.refetch();
            }}
          />
        ) : null}
        {overrideNotice ? (
          <Alert
            variant="attention"
            role="status"
            title={t(
              overrideNotice.kind === "downgrade"
                ? "members.override.downgrade.title"
                : "members.override.remove.title",
            )}
          >
            <p>
              {t(
                overrideNotice.kind === "downgrade"
                  ? "members.override.downgrade.description"
                  : "members.override.remove.description",
                { login: overrideNotice.login },
              )}
            </p>
            <p>
              {t("members.override.effectiveRole")}{" "}
              <strong className="font-semibold">
                {t(`staff.role.${overrideNotice.effectiveRole}`)}
              </strong>
            </p>
            <div className="mt-2">
              <Button variant="secondary" size="sm" onClick={() => setOverrideNotice(null)}>
                {t("members.notice.dismiss")}
              </Button>
            </div>
          </Alert>
        ) : null}
        <AddMember onMutationError={handleMutationError} />
        <section aria-labelledby="active-staff-heading" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="active-staff-heading" className="text-base font-semibold">
              {t("members.active.title")}
            </h2>
            <span className="text-xs text-muted-foreground">
              {t("members.active.count", { count: members.length })}
            </span>
          </div>
          <div className="overflow-hidden rounded-md border">
            {members.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">{t("members.active.empty")}</p>
            ) : (
              <ul>
                {members.map((member) => (
                  <MemberRow
                    key={member.login}
                    member={member}
                    adminCount={adminCount}
                    onOverride={setOverrideNotice}
                    onMutationError={handleMutationError}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
        <section aria-labelledby="pending-invitations-heading" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="pending-invitations-heading" className="text-base font-semibold">
              {t("members.invitations.title")}
            </h2>
            <span className="text-xs text-muted-foreground">
              {t("members.invitations.count", { count: invitations.length })}
            </span>
          </div>
          <div className="overflow-hidden rounded-md border">
            {invitations.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                {t("members.invitations.empty")}
              </p>
            ) : (
              <ul>
                {invitations.map((invitation) => (
                  <InvitationRow
                    key={invitation.id}
                    invitation={invitation}
                    onMutationError={handleMutationError}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </>
    );
  }

  return (
    <RequireAdmin>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{t("members.title")}</h1>
          <p className="text-muted-foreground">
            {t("members.intro")}{" "}
            <Link to="/staff/allowlist" className="text-link underline">
              {t("members.intro.allowlistLink")}
            </Link>
          </p>
        </div>
        {content}
      </div>
    </RequireAdmin>
  );
}
