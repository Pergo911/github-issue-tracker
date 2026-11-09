import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { endpoints, type ApiErrorCode } from "@shared/api/endpoints.ts";
import { FIELD_ERRORS, collectErrors, type FieldError } from "@shared/reports/validate.ts";
import { MAX_DESCRIPTION, MAX_PLACE, MAX_TITLE, normalizeEmail } from "@shared/reports/validate.ts";
import type { Translator } from "@shared/i18n/index.ts";
import { ApiError, callApi } from "@/api/call-api.ts";
import { apiErrorMessage } from "@/api/error-message.ts";
import { usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { Alert } from "@/ui/alert.tsx";
import { Button } from "@/ui/button.tsx";
import { Field, describedBy } from "@/ui/field.tsx";
import { Input, Select, Textarea } from "@/ui/input.tsx";
import { Confirmation, type FiledReport } from "./confirmation.tsx";
import {
  attemptCredential,
  clearPending,
  forgetCredential,
  pendingSubmission,
  rememberPending,
} from "./credential.ts";
import { NeedsHelp, StillSaving } from "./recovery-states.tsx";

/** How often the tab asks a still-saving submission how it stands, and one that needs a person. */
// The resume endpoint allows 10 a minute per address (SPEC 4.5): never ask faster than that.
const SAVING_POLL_MS = 7_000;
const HELP_POLL_MS = 30_000;

/** What the final submit's outcome left the tab showing instead of the form (SPEC 4.1, ADR 0005). */
type Recovery =
  | { kind: "saving" }
  /** `resumable`: the credential in this tab belongs to the attempt that needs help. */
  | { kind: "help"; reference: string; resumable: boolean };

/** The outcomes whose result the Reporter never learned: the marker stays, so a refresh can resume. */
const UNKNOWN_OUTCOME: readonly ApiErrorCode[] = [
  "network_error",
  "invalid_response",
  "internal_error",
  "upstream_unavailable",
];

/** The resend countdown the client runs itself: the server's cooldown is silent (SPEC 4.1, 4.5). */
const RESEND_COOLDOWN_SECONDS = 60;

interface Values {
  email: string;
  category: string;
  location: string;
  title: string;
  description: string;
  place: string;
  code: string;
}

const emptyValues: Values = {
  email: "",
  category: "",
  location: "",
  title: "",
  description: "",
  place: "",
  code: "",
};

type FieldKey = keyof Values;
type ErrorCode = FieldError | "invalid_code" | "emailInvalid" | "codeInvalid";
type Errors = Partial<Record<FieldKey, ErrorCode>>;

const emailSchema = z.email();

function messageOf(t: Translator, code: ErrorCode): string {
  if (code === "emailInvalid") return t("form.error.emailInvalid");
  if (code === "codeInvalid") return t("form.error.codeInvalid");
  return t(`api.error.${code}`);
}

function isFieldError(code: ApiErrorCode): code is FieldError {
  return (FIELD_ERRORS as readonly string[]).includes(code);
}

const fieldOfError: Record<FieldError, FieldKey> = {
  title_length: "title",
  title_characters: "title",
  description_length: "description",
  place_length: "place",
  unknown_category: "category",
  unknown_location: "location",
};

/** The current time, refreshed four times a second while `active`, so a countdown stays accurate. */
function useNow(active: boolean): [number, () => void] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return [now, () => setNow(Date.now())];
}

/** The Submission form (SPEC 4.1): fill in everything, request a code, enter it and submit. Lazy-loaded. */
export function Component() {
  const t = useT();
  const config = usePublicConfig();
  const [values, setValues] = useState<Values>(emptyValues);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState<"code" | "submit" | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [filed, setFiled] = useState<FiledReport | null>(null);
  // A submission this tab dispatched and never heard the end of: resume it (also after a refresh).
  const [recovery, setRecovery] = useState<Recovery | null>(() =>
    pendingSubmission() ? { kind: "saving" } : null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const dispatched = useRef<{ email: string; credential: string } | null>(null);
  // What the dispatch failed with when its outcome was unknown, shown if the server turns out never to have seen it.
  const dispatchFailure = useRef<unknown>(null);
  const focusInvalid = useRef(0);
  const [now, refreshNow] = useNow(resendAt !== null);
  const secondsLeft = resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000));

  const taxonomy = {
    categories: config.taxonomy.category.map((value) => value.id),
    locations: config.taxonomy.location.map((value) => value.id),
  };

  useDocumentTitle(
    filed
      ? t("confirmation.title")
      : recovery?.kind === "saving"
        ? t("saving.title")
        : recovery?.kind === "help"
          ? t("help.title")
          : t("form.heading"),
    config.displayName,
  );

  // While the submission is saving, or needs a person, ask how it stands: complete shows the confirmation page.
  const resumable = recovery !== null && (recovery.kind === "saving" || recovery.resumable);
  const recoveryKind = recovery?.kind;
  useEffect(() => {
    if (!resumable) return undefined;
    // The stored marker survives a refresh; the ref covers a tab whose storage is blocked.
    const pending = pendingSubmission() ?? dispatched.current;
    if (!pending) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(current: { email: string; credential: string }) {
      let next = recoveryKind === "help" ? HELP_POLL_MS : SAVING_POLL_MS;
      try {
        const result = await callApi(endpoints.resumeSubmission, current);
        if (cancelled) return;
        if (result.status === "complete") {
          forgetCredential();
          setRecovery(null);
          setFiled({ number: result.number, title: result.title, statusUrl: result.statusUrl });
          return;
        }
        if (result.status === "needs_help") {
          setRecovery({ kind: "help", reference: result.reference, resumable: true });
          next = HELP_POLL_MS;
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.code === "not_found") {
          // The server holds nothing for this credential (never reached, spent, or its link replaced).
          forgetCredential();
          setRecovery(null);
          setFailure(dispatchFailure.current ?? error);
          return;
        }
        next = Math.max(next, 15_000);
      }
      timer = setTimeout(() => void poll(current), next);
    }
    void poll(pending);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [resumable, recoveryKind]);

  // After a failed check, move focus to the first control that reports a problem.
  useEffect(() => {
    if (focusInvalid.current === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const set = (key: FieldKey) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    // Editing a field clears its own message, so a fixed field stops saying it is wrong.
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  function checkFields(): Errors {
    const found: Errors = { ...collectErrors(values, taxonomy) };
    if (!emailSchema.safeParse(values.email.trim()).success) found.email = "emailInvalid";
    return found;
  }

  function reject(found: Errors): boolean {
    const cleaned = Object.fromEntries(Object.entries(found).filter(([, code]) => code)) as Errors;
    setErrors(cleaned);
    focusInvalid.current += 1;
    return Object.keys(cleaned).length > 0;
  }

  async function requestCode() {
    setBusy("code");
    setFailure(null);
    try {
      await callApi(endpoints.requestCode, { email: normalizeEmail(values.email) });
      setCodeSent(true);
      refreshNow();
      setResendAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy("submit");
    setFailure(null);
    const email = normalizeEmail(values.email);
    const credential = attemptCredential();
    // Before the dispatch: if the answer is lost, a refresh of this tab resumes the same attempt.
    rememberPending(email);
    dispatched.current = { email, credential };
    dispatchFailure.current = null;
    try {
      const report = await callApi(endpoints.submitReport, {
        email,
        code: values.code.trim(),
        credential,
        category: values.category,
        location: values.location,
        title: values.title,
        description: values.description,
        place: values.place,
      });
      forgetCredential();
      setFiled(report);
    } catch (error) {
      if (error instanceof ApiError && error.code === "submission_pending") {
        setRecovery({ kind: "saving" });
      } else if (error instanceof ApiError && error.code === "submission_unresolved") {
        // An earlier attempt for this address needs a person; this one created nothing.
        clearPending();
        setRecovery({ kind: "help", reference: error.reference ?? "", resumable: false });
      } else {
        // Refused before anything was created: the attempt is over. An unknown outcome keeps its marker and
        // goes straight to resuming: the answer may have been lost after the Report was created.
        const unknown = error instanceof ApiError && UNKNOWN_OUTCOME.includes(error.code);
        if (!unknown) clearPending();
        if (unknown) {
          dispatchFailure.current = error;
          setRecovery({ kind: "saving" });
        } else if (error instanceof ApiError && isFieldError(error.code)) {
          reject({ [fieldOfError[error.code]]: error.code });
        } else if (error instanceof ApiError && error.code === "invalid_code") {
          reject({ code: "invalid_code" });
        } else {
          setFailure(error);
        }
      }
    } finally {
      setBusy(null);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const found = checkFields();
    if (codeSent && !/^\d{6}$/.test(values.code.trim())) found.code = "codeInvalid";
    if (reject(found)) return;
    void (codeSent ? submit() : requestCode());
  }

  function startOver() {
    setValues(emptyValues);
    setErrors({});
    setFailure(null);
    setCodeSent(false);
    setResendAt(null);
    setFiled(null);
    setRecovery(null);
  }

  if (recovery?.kind === "saving") return <StillSaving />;
  if (recovery?.kind === "help") {
    return <NeedsHelp reference={recovery.reference} contact={config.codeSentHelp} />;
  }
  if (filed) return <Confirmation report={filed} onAnother={startOver} />;

  const errorCount = Object.keys(errors).length;
  const error = (key: FieldKey) => {
    const code = errors[key];
    return code ? messageOf(t, code) : undefined;
  };
  const counter = (text: string, max: number) =>
    t("form.counter", { count: [...text].length, max });
  const locked = busy !== null;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{t("form.heading")}</h1>
        <p className="text-muted-foreground">{t("form.intro")}</p>
      </div>

      {config.emergencyNotice ? (
        <Alert variant="attention" title={t("form.emergency.title")}>
          <p>{config.emergencyNotice}</p>
        </Alert>
      ) : null}

      <form ref={formRef} noValidate onSubmit={onSubmit} aria-busy={locked}>
        <fieldset disabled={locked} className="flex min-w-0 flex-col gap-4 border-0 p-0">
          {errorCount > 0 ? (
            <Alert variant="danger" role="alert">
              <p>{t("form.error.summary")}</p>
            </Alert>
          ) : null}
          {failure !== null ? (
            <Alert variant="danger" role="alert">
              <p>{apiErrorMessage(t, failure)}</p>
            </Alert>
          ) : null}

          <Field
            id="email"
            label={t("form.email.label")}
            hint={t("form.email.hint")}
            error={error("email")}
          >
            <Input
              type="email"
              autoComplete="email"
              readOnly={codeSent}
              value={values.email}
              onChange={(event) => set("email")(event.target.value)}
              {...describedBy("email", { hint: true, error: Boolean(errors.email) })}
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field id="category" label={t("form.category.label")} error={error("category")}>
              <Select
                value={values.category}
                onChange={(event) => set("category")(event.target.value)}
                {...describedBy("category", { error: Boolean(errors.category) })}
              >
                <option value="">{t("form.select.placeholder")}</option>
                {config.taxonomy.category.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="location" label={t("form.location.label")} error={error("location")}>
              <Select
                value={values.location}
                onChange={(event) => set("location")(event.target.value)}
                {...describedBy("location", { error: Boolean(errors.location) })}
              >
                <option value="">{t("form.select.placeholder")}</option>
                {config.taxonomy.location.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            id="title"
            label={t("form.title.label")}
            hint={t("form.title.hint")}
            error={error("title")}
            counter={counter(values.title, MAX_TITLE)}
          >
            <Input
              value={values.title}
              onChange={(event) => set("title")(event.target.value)}
              {...describedBy("title", { hint: true, error: Boolean(errors.title) })}
            />
          </Field>

          <Field
            id="description"
            label={t("form.description.label")}
            hint={t("form.description.hint")}
            error={error("description")}
            counter={counter(values.description, MAX_DESCRIPTION)}
          >
            <Textarea
              rows={6}
              value={values.description}
              onChange={(event) => set("description")(event.target.value)}
              {...describedBy("description", { hint: true, error: Boolean(errors.description) })}
            />
          </Field>

          <Field
            id="place"
            label={t("form.place.label")}
            hint={t("form.place.hint")}
            error={error("place")}
            counter={counter(values.place, MAX_PLACE)}
          >
            <Input
              value={values.place}
              onChange={(event) => set("place")(event.target.value)}
              {...describedBy("place", { hint: true, error: Boolean(errors.place) })}
            />
          </Field>

          {codeSent ? (
            <section
              aria-labelledby="code-sent-title"
              className="flex flex-col gap-4 rounded-md border bg-muted p-4"
            >
              <div className="flex flex-col gap-2">
                <h2 id="code-sent-title" className="text-base font-semibold">
                  {t("form.codeSent.title")}
                </h2>
                <p>{t("form.codeSent.description")}</p>
                <p className="text-muted-foreground">
                  <span className="font-semibold">{t("form.codeSent.noCode")}</span>{" "}
                  {config.codeSentHelp}
                </p>
              </div>
              <Field
                id="code"
                label={t("form.code.label")}
                hint={t("form.code.hint")}
                error={error("code")}
              >
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="max-w-40 tracking-widest"
                  value={values.code}
                  onChange={(event) => set("code")(event.target.value.replace(/\D/g, ""))}
                  {...describedBy("code", { hint: true, error: Boolean(errors.code) })}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {secondsLeft > 0 ? (
                  <p className="text-muted-foreground">
                    {t("form.resend.wait", { seconds: secondsLeft })}
                  </p>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => void requestCode()}>
                    {t("form.resend")}
                  </Button>
                )}
                <Button type="button" variant="ghost" onClick={startOver}>
                  {t("form.changeAddress")}
                </Button>
              </div>
            </section>
          ) : null}

          <div>
            <Button type="submit">
              {busy === "code"
                ? t("form.sendingCode")
                : busy === "submit"
                  ? t("form.submitting")
                  : codeSent
                    ? t("form.submit")
                    : t("form.sendCode")}
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
