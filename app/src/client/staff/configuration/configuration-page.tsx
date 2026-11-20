import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router";
import { endpoints, type LabelSync } from "@shared/api/endpoints.ts";
import { TEMPLATE_PLACEHOLDERS } from "@shared/config/defaults.ts";
import { toPublicConfig } from "@shared/config/public.ts";
import { LANGUAGES, type Config } from "@shared/config/schema.ts";
import { ApiError } from "@/api/call-api.ts";
import { apiErrorMessage } from "@/api/error-message.ts";
import { useConfigured, useFormatter, usePublicConfig } from "@/config/context.tsx";
import { publicConfigQuery } from "@/config/queries.ts";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { cn } from "@/lib/utils.ts";
import { Alert } from "@/ui/alert.tsx";
import { Button } from "@/ui/button.tsx";
import { callAsStaff } from "../admin/call.ts";
import { RequireAdmin } from "../admin/require-admin.tsx";
import { Loading } from "../admin/spinner.tsx";
import { SelectField, TextAreaField, TextField, type FieldErrors } from "./fields.tsx";
import { draftToPayload, toDraft, type Draft } from "./model.ts";
import { TaxonomyEditor } from "./taxonomy-editor.tsx";

const SECTIONS = ["organization", "taxonomy", "email", "templates", "system"] as const;
type Section = (typeof SECTIONS)[number];

const TEMPLATE_NAMES = Object.keys(TEMPLATE_PLACEHOLDERS) as (keyof typeof TEMPLATE_PLACEHOLDERS)[];

/** Which section a refused field belongs to, for the problem count on its tab. */
function sectionOf(path: string): Section {
  if (path.startsWith("taxonomy")) return "taxonomy";
  if (path.startsWith("email.templates")) return "templates";
  if (path.startsWith("email")) return "email";
  if (["language", "timezone", "dailyCodeBudget"].includes(path)) return "system";
  return "organization";
}

function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf(
      "timeZone",
    );
  } catch {
    return [];
  }
}

type Update = (change: (draft: Draft) => void) => void;

function Organization({
  draft,
  errors,
  update,
}: {
  draft: Draft;
  errors: FieldErrors;
  update: Update;
}) {
  const t = useT();
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <TextField
        id="displayName"
        label={t("config.displayName.label")}
        hint={t("config.displayName.hint")}
        errors={errors}
        path="displayName"
        value={draft.displayName}
        onChange={(event) => update((d) => void (d.displayName = event.target.value))}
      />
      <TextAreaField
        id="emergencyNotice"
        label={t("config.emergencyNotice.label")}
        hint={t("config.emergencyNotice.hint")}
        errors={errors}
        path="emergencyNotice"
        value={draft.emergencyNotice}
        onChange={(event) => update((d) => void (d.emergencyNotice = event.target.value))}
      />
      <TextAreaField
        id="codeSentHelp"
        label={t("config.codeSentHelp.label")}
        hint={t("config.codeSentHelp.hint")}
        errors={errors}
        path="codeSentHelp"
        value={draft.codeSentHelp}
        onChange={(event) => update((d) => void (d.codeSentHelp = event.target.value))}
      />
    </div>
  );
}

function EmailSender({
  draft,
  errors,
  update,
}: {
  draft: Draft;
  errors: FieldErrors;
  update: Update;
}) {
  const t = useT();
  const set =
    (key: "senderLocalPart" | "senderName" | "replyTo" | "replyClause" | "footer") =>
    (event: { target: { value: string } }) =>
      update((d) => void (d.email[key] = event.target.value));
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <TextField
        id="senderLocalPart"
        label={t("config.email.senderLocalPart.label")}
        hint={t("config.email.senderLocalPart.hint")}
        errors={errors}
        path="email.senderLocalPart"
        value={draft.email.senderLocalPart}
        spellCheck={false}
        autoComplete="off"
        onChange={set("senderLocalPart")}
      />
      <TextField
        id="senderName"
        label={t("config.email.senderName.label")}
        errors={errors}
        path="email.senderName"
        value={draft.email.senderName}
        onChange={set("senderName")}
      />
      <TextField
        id="replyTo"
        label={t("config.email.replyTo.label")}
        hint={t("config.email.replyTo.hint")}
        errors={errors}
        path="email.replyTo"
        type="email"
        value={draft.email.replyTo}
        spellCheck={false}
        onChange={set("replyTo")}
      />
      <TextField
        id="replyClause"
        label={t("config.email.replyClause.label")}
        hint={t("config.email.replyClause.hint", { placeholder: "{reply}" })}
        errors={errors}
        path="email.replyClause"
        value={draft.email.replyClause}
        onChange={set("replyClause")}
      />
      <TextField
        id="footer"
        label={t("config.email.footer.label")}
        hint={t("config.email.footer.hint", { placeholder: "{reply}" })}
        errors={errors}
        path="email.footer"
        value={draft.email.footer}
        onChange={set("footer")}
      />
    </div>
  );
}

function Templates({
  draft,
  errors,
  update,
}: {
  draft: Draft;
  errors: FieldErrors;
  update: Update;
}) {
  const t = useT();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {TEMPLATE_NAMES.map((name) => (
        <fieldset key={name} className="flex flex-col gap-3 rounded-md border bg-card p-4">
          <legend className="px-1 text-base font-semibold">{t(`config.template.${name}`)}</legend>
          <p className="text-sm text-muted-foreground">
            {t("config.template.placeholders", {
              list: TEMPLATE_PLACEHOLDERS[name].map((placeholder) => `{${placeholder}}`).join(" "),
            })}
          </p>
          <TextField
            id={`template-${name}-subject`}
            label={t("config.template.subject")}
            errors={errors}
            path={`email.templates.${name}.subject`}
            value={draft.email.templates[name].subject}
            onChange={(event) =>
              update((d) => void (d.email.templates[name].subject = event.target.value))
            }
          />
          <TextAreaField
            id={`template-${name}-body`}
            label={t("config.template.body")}
            errors={errors}
            path={`email.templates.${name}.body`}
            rows={7}
            value={draft.email.templates[name].body}
            onChange={(event) =>
              update((d) => void (d.email.templates[name].body = event.target.value))
            }
          />
        </fieldset>
      ))}
    </div>
  );
}

function System({ draft, errors, update }: { draft: Draft; errors: FieldErrors; update: Update }) {
  const t = useT();
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <SelectField
        id="language"
        label={t("config.language.label")}
        hint={t("config.language.hint")}
        errors={errors}
        path="language"
        value={draft.language}
        onChange={(event) => update((d) => void (d.language = event.target.value))}
      >
        {LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {t(`config.language.${language}`)}
          </option>
        ))}
      </SelectField>
      <TextField
        id="timezone"
        label={t("config.timezone.label")}
        hint={t("config.timezone.hint", { example: "Europe/Budapest" })}
        errors={errors}
        path="timezone"
        list="timezone-names"
        value={draft.timezone}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => update((d) => void (d.timezone = event.target.value))}
      />
      <datalist id="timezone-names">
        {timeZones().map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <TextField
        id="dailyCodeBudget"
        label={t("config.budget.label")}
        hint={t("config.budget.hint")}
        errors={errors}
        path="dailyCodeBudget"
        type="number"
        min={1}
        step={1}
        value={draft.dailyCodeBudget}
        onChange={(event) => update((d) => void (d.dailyCodeBudget = event.target.value))}
      />
    </div>
  );
}

/** The form itself, mounted once the stored configuration (or its absence) is known. */
function ConfigurationForm({ stored }: { stored: Config | null }) {
  const t = useT();
  const format = useFormatter();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const configured = useConfigured();
  const [params] = useSearchParams();
  const requested = params.get("section");
  const section: Section = SECTIONS.find((item) => item === requested) ?? "organization";

  const [saved, setSaved] = useState<Config | null>(stored);
  const [draft, setDraft] = useState(() => toDraft(stored));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sync, setSync] = useState<LabelSync | null>(null);
  const summary = useRef<HTMLDivElement>(null);

  const update: Update = (change) => {
    setDraft((current) => {
      const next = structuredClone(current);
      change(next);
      return next;
    });
  };

  const save = useMutation({
    mutationFn: () => callAsStaff(endpoints.configSave, { config: draftToPayload(draft) }),
    onSuccess: (result) => {
      setErrors({});
      setSync(result.sync);
      setSaved(result.config);
      setDraft(toDraft(result.config));
      queryClient.setQueryData(["staff", "config"], { config: result.config });
      // The SPA's own configuration follows: the language, the name and the taxonomy change under the admin.
      queryClient.setQueryData(publicConfigQuery.queryKey, toPublicConfig(result.config));
      if (!configured) void navigate("/staff/reports", { replace: true });
    },
    onError: (error) => {
      setSync(null);
      if (error instanceof ApiError && error.code === "invalid_config") {
        setErrors(Object.fromEntries(error.fields.map((field) => [field.path, field.code])));
      } else setErrors({});
    },
  });

  useEffect(() => {
    if (save.isError || save.isSuccess) summary.current?.focus();
  }, [save.isError, save.isSuccess, save.submittedAt]);

  const problems = Object.keys(errors);
  const perSection = (item: Section) => problems.filter((path) => sectionOf(path) === item).length;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{t("config.title")}</h1>
        <p className="text-muted-foreground">{t("config.intro")}</p>
        {saved?.lastEditor ? (
          <p className="text-sm text-muted-foreground">
            {t("config.lastEdited", {
              login: saved.lastEditor.editedBy,
              date: format.dateTime(saved.lastEditor.editedAt),
            })}
          </p>
        ) : null}
      </div>

      {!configured || stored === null ? (
        <Alert variant="attention" title={t("config.fresh.title")}>
          <p>{t("config.fresh.description")}</p>
        </Alert>
      ) : null}

      <div ref={summary} tabIndex={-1} className="flex flex-col gap-2 outline-none">
        {save.isError ? (
          <Alert variant="danger" role="alert" title={t("config.invalid.title")}>
            {problems.length > 0 ? (
              <p>{t("config.invalid.description", { count: problems.length })}</p>
            ) : (
              <p>{apiErrorMessage(t, save.error)}</p>
            )}
          </Alert>
        ) : null}
        {save.isSuccess && sync ? (
          <Alert role="status" title={t("config.saved.title")}>
            <p>
              {t("config.saved.sync", {
                created: sync.created.length,
                recoloured: sync.recoloured.length,
              })}
            </p>
          </Alert>
        ) : null}
      </div>

      <nav aria-label={t("config.sections.label")} className="border-b">
        <ul className="-mb-px flex flex-wrap gap-1">
          {SECTIONS.map((item) => (
            <li key={item}>
              <NavLink
                to={`?section=${item}`}
                replace
                aria-current={section === item ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-t-md border-b-2 border-transparent px-3 text-sm hover:bg-accent",
                  section === item && "border-attention font-semibold",
                )}
              >
                {t(`config.section.${item}`)}
                {perSection(item) > 0 ? (
                  <span className="rounded-full bg-danger-muted px-2 text-xs font-medium text-danger">
                    {t("config.section.problems", { count: perSection(item) })}
                  </span>
                ) : null}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {section === "organization" ? (
        <Organization draft={draft} errors={errors} update={update} />
      ) : null}
      {section === "taxonomy" ? (
        <TaxonomyEditor draft={draft} errors={errors} update={update} />
      ) : null}
      {section === "email" ? <EmailSender draft={draft} errors={errors} update={update} /> : null}
      {section === "templates" ? <Templates draft={draft} errors={errors} update={update} /> : null}
      {section === "system" ? <System draft={draft} errors={errors} update={update} /> : null}

      <div className="border-t pt-4">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t("config.saving") : t("config.save")}
        </Button>
      </div>
    </form>
  );
}

/**
 * The Configuration screen (SPEC 2.4), System admin only: every per-Deployment value that is data, in five
 * sections of one form with one Save. The Worker validates and answers with field errors; the save is also the
 * label sync. On a fresh Deployment it is pre-filled with the starter configuration, and the first valid save
 * creates the `config` key.
 */
export function Component() {
  const t = useT();
  const { displayName } = usePublicConfig();
  useDocumentTitle(t("config.title"), ...(displayName ? [displayName] : []));
  const read = useQuery({
    queryKey: ["staff", "config"],
    queryFn: () => callAsStaff(endpoints.configRead, {}),
    retry: false,
    refetchOnMount: "always",
    // The form owns its draft once loaded: a background refetch must not replace what is being typed.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  let body;
  if (read.isPending) body = <Loading text={t("config.loading")} />;
  else if (read.isError) {
    body = (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <h1 className="text-xl font-semibold">{t("config.loadFailed.title")}</h1>
        <p className="text-muted-foreground">{apiErrorMessage(t, read.error)}</p>
        <Button variant="secondary" onClick={() => void read.refetch()}>
          {t("boot.retry")}
        </Button>
      </div>
    );
  } else body = <ConfigurationForm stored={read.data.config} />;

  return <RequireAdmin>{body}</RequireAdmin>;
}
