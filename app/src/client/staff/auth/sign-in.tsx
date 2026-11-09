import { LinkExternalIcon } from "@primer/octicons-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { endpoints } from "@shared/api/endpoints.ts";
import { GITHUB_WEB_BASE_DEFAULT } from "@shared/github/constants.ts";
import { ApiError, callApi } from "@/api/call-api.ts";
import { apiErrorMessage } from "@/api/error-message.ts";
import { usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { Button, buttonVariants } from "@/ui/button.tsx";
import { runDeviceFlow, type DeviceFlowState } from "./device-flow.ts";
import { tokenStore } from "./token-store.ts";

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Starts the device flow, and hands the tokens to the store when the member approves it. */
function useDeviceFlow() {
  const [state, setState] = useState<DeviceFlowState | null>(null);
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState(null);
  }, []);

  const start = useCallback(() => {
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    void runDeviceFlow({
      start: () => callApi(endpoints.staffDeviceCode),
      poll: (deviceCode) => callApi(endpoints.staffDeviceToken, { deviceCode }),
      sleep,
      now: Date.now,
      signal: mine.signal,
      onState: (next) => {
        if (mine.signal.aborted) return;
        if (next.kind === "authorized") tokenStore.save(next.tokens);
        else if (next.kind !== "aborted") setState(next);
      },
    });
  }, []);

  useEffect(() => () => controller.current?.abort(), []);
  return { state, start, cancel };
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-md border bg-card p-6 shadow-resting">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

/** The Staff sign-in and the device-code screens (SPEC 2.2). "GitHub" appears here only as a plain fact. */
export function SignIn() {
  const t = useT();
  const { displayName } = usePublicConfig();
  const location = useLocation();
  const { state, start, cancel } = useDeviceFlow();
  const signedOut = (location.state as { signedOut?: boolean } | null)?.signedOut === true;
  useDocumentTitle(t("staff.signIn.title"), displayName);

  if (state?.kind === "pending") {
    const { code } = state;
    return (
      <Card title={t("staff.device.title")}>
        <p className="text-muted-foreground">{t("staff.device.instructions")}</p>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("staff.device.codeLabel")}</span>
          <p className="rounded-md border bg-muted px-4 py-3 text-center font-mono text-2xl font-semibold tracking-widest">
            {code.userCode}
          </p>
        </div>
        <a
          href={code.verificationUri}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "default" })}
        >
          {t("staff.device.open")}
          <LinkExternalIcon size={16} aria-hidden="true" />
        </a>
        <p role="status" className="text-muted-foreground">
          {t("staff.device.waiting")}
        </p>
        <Button variant="secondary" onClick={cancel}>
          {t("staff.device.cancel")}
        </Button>
      </Card>
    );
  }

  if (state?.kind === "expired") {
    return (
      <Card title={t("staff.device.expired.title")}>
        <p className="text-muted-foreground">{t("staff.device.expired.description")}</p>
        <Button onClick={start}>{t("staff.device.restart")}</Button>
      </Card>
    );
  }

  if (state?.kind === "denied") {
    return (
      <Card title={t("staff.device.denied.title")}>
        <p className="text-muted-foreground">{t("staff.device.denied.description")}</p>
        <Button onClick={start}>{t("staff.device.restart")}</Button>
      </Card>
    );
  }

  if (state?.kind === "error") {
    return (
      <Card title={t("staff.device.error.title")}>
        <p className="text-muted-foreground">{apiErrorMessage(t, new ApiError(state.code, 0))}</p>
        <Button onClick={start}>{t("boot.retry")}</Button>
      </Card>
    );
  }

  return (
    <Card title={t("staff.signIn.title")}>
      {signedOut ? (
        <div role="status" className="flex flex-col gap-1 rounded-md border bg-muted p-3 text-sm">
          <p className="font-semibold">{t("staff.signedOut.notice")}</p>
          <p className="text-muted-foreground">{t("staff.signedOut.revoke")}</p>
          <a
            href={`${GITHUB_WEB_BASE_DEFAULT}/settings/applications`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-link hover:underline"
          >
            {t("staff.signedOut.revokeLink")}
            <LinkExternalIcon size={12} aria-hidden="true" />
          </a>
        </div>
      ) : null}
      <p className="text-muted-foreground">{t("staff.signIn.intro")}</p>
      <Button onClick={start} disabled={state?.kind === "requesting"}>
        {state?.kind === "requesting" ? t("staff.signIn.starting") : t("staff.signIn.start")}
      </Button>
    </Card>
  );
}
