import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertIcon } from "@primer/octicons-react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { roleAtLeast, type StaffRole } from "@shared/github/roles.ts";
import { ApiError } from "@/api/call-api.ts";
import { apiErrorMessage } from "@/api/error-message.ts";
import { useConfigured, usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/ui/button.tsx";
import { SignIn } from "./auth/sign-in.tsx";
import { staffMetaQuery, useTokens } from "./auth/session.ts";
import { StaffProvider } from "./auth/staff-context.tsx";
import { tokenStore } from "./auth/token-store.ts";

interface NavItem {
  to: string;
  label: "staff.nav.reports" | "staff.nav.allowlist" | "staff.nav.configuration";
  /** The lowest role that sees the link. Admin links are for System admins only (SPEC 2.4). */
  minimum: StaffRole;
}

const NAV: readonly NavItem[] = [
  { to: "/staff/reports", label: "staff.nav.reports", minimum: "viewer" },
  { to: "/staff/allowlist", label: "staff.nav.allowlist", minimum: "admin" },
  { to: "/staff/configuration", label: "staff.nav.configuration", minimum: "admin" },
];

function Message({
  title,
  description,
  children,
  loading,
}: {
  title?: string;
  description?: string;
  children?: React.ReactNode;
  loading?: string;
}) {
  if (loading) {
    return (
      <div role="status" className="flex items-center gap-3 py-8 text-muted-foreground">
        <span
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-border border-t-link motion-reduce:animate-none"
        />
        {loading}
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-md border bg-card p-6 text-center shadow-resting">
      <AlertIcon size={32} className="text-attention" aria-hidden="true" />
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}

function SignOutButton() {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        tokenStore.clear();
        queryClient.removeQueries({ queryKey: ["staff"] });
        void navigate("/staff/reports", { state: { signedOut: true } });
      }}
    >
      {t("staff.signOut")}
    </Button>
  );
}

/**
 * The Staff dashboard's frame and gate (SPEC 2.2, 2.4): signed out shows the sign-in; a member's role comes from
 * the role-gated metadata endpoint; a non-member gets the no-access screen. This is the root of the `staff/`
 * chunk: nothing outside it imports from here, so reporters never download it.
 */
export function Component() {
  const t = useT();
  const { displayName } = usePublicConfig();
  const tokens = useTokens();
  const meta = useQuery({ ...staffMetaQuery, enabled: tokens !== null });
  const configured = useConfigured();
  const { pathname } = useLocation();
  useDocumentTitle(t("staff.title"), displayName);

  if (tokens === null) return <SignIn />;
  if (meta.isPending) return <Message loading={t("staff.checking")} />;
  if (meta.isError) {
    const forbidden = meta.error instanceof ApiError && meta.error.code === "forbidden";
    if (forbidden) {
      return (
        <Message title={t("staff.noAccess.title")} description={t("staff.noAccess.description")}>
          <SignOutButton />
        </Message>
      );
    }
    return (
      <Message title={t("staff.metaFailed.title")} description={apiErrorMessage(t, meta.error)}>
        <Button variant="secondary" onClick={() => void meta.refetch()}>
          {t("boot.retry")}
        </Button>
      </Message>
    );
  }

  const { role, login } = meta.data;
  if (!configured) {
    // A fresh Deployment (SPEC 2.4): a System admin is taken to the Configuration screen to set it up, and
    // everyone else is told it is not configured.
    if (role !== "admin") {
      return (
        <Message
          title={t("staff.notConfigured.title")}
          description={t("staff.notConfigured.description")}
        >
          <SignOutButton />
        </Message>
      );
    }
    if (pathname !== "/staff/configuration") return <Navigate to="/staff/configuration" replace />;
  }
  return (
    <StaffProvider value={meta.data}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b pb-3">
          <nav aria-label={t("staff.nav.label")}>
            <ul className="flex flex-wrap gap-1">
              {NAV.filter(
                (item) =>
                  roleAtLeast(role, item.minimum) &&
                  (configured || item.to === "/staff/configuration"),
              ).map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium hover:bg-accent",
                        isActive && "bg-accent-muted font-semibold",
                      )
                    }
                  >
                    {t(item.label)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {t("staff.account.signedInAs", { login })}
              {" · "}
              {t(`staff.role.${role}`)}
            </span>
            <SignOutButton />
          </div>
        </div>
        <Outlet />
      </div>
    </StaffProvider>
  );
}
