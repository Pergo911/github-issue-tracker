import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { MAX_BULK_LINES, MAX_NOTE_LENGTH, type AllowlistEntry } from "@shared/allowlist/entries.ts";
import { endpoints } from "@shared/api/endpoints.ts";
import { apiErrorMessage } from "@/api/error-message.ts";
import { useFormatter, usePublicConfig } from "@/config/context.tsx";
import { useT } from "@/i18n/context.tsx";
import { useDocumentTitle } from "@/lib/document-title.ts";
import { Alert } from "@/ui/alert.tsx";
import { Button } from "@/ui/button.tsx";
import { Field, describedBy } from "@/ui/field.tsx";
import { Input, Textarea } from "@/ui/input.tsx";
import { callAsStaff } from "../admin/call.ts";
import { RequireAdmin } from "../admin/require-admin.tsx";
import { Loading } from "../admin/spinner.tsx";

const allowlistQuery = {
  queryKey: ["staff", "allowlist"],
  queryFn: () => callAsStaff(endpoints.allowlistList, {}),
  retry: false,
  refetchOnMount: "always",
} as const;

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: allowlistQuery.queryKey });
}

function AddOne() {
  const t = useT();
  const refresh = useRefresh();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const add = useMutation({
    mutationFn: () =>
      callAsStaff(endpoints.allowlistAdd, { email, ...(note.trim() ? { note } : {}) }),
    onSuccess: async () => {
      setEmail("");
      setNote("");
      await refresh();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <h2 className="text-base font-semibold">{t("allowlist.add.title")}</h2>
      <Field
        id="allowlist-email"
        label={t("allowlist.add.email")}
        error={add.isError ? apiErrorMessage(t, add.error) : undefined}
      >
        <Input
          {...describedBy("allowlist-email", { error: add.isError })}
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            add.reset();
          }}
          required
        />
      </Field>
      <Field
        id="allowlist-note"
        label={t("allowlist.add.note")}
        hint={t("allowlist.add.noteHint")}
        counter={`${[...note].length} / ${MAX_NOTE_LENGTH}`}
      >
        <Input
          {...describedBy("allowlist-note", { hint: true })}
          maxLength={MAX_NOTE_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? t("allowlist.add.submitting") : t("allowlist.add.submit")}
        </Button>
      </div>
    </form>
  );
}

function AddMany() {
  const t = useT();
  const refresh = useRefresh();
  const [text, setText] = useState("");
  const bulk = useMutation({
    mutationFn: () => callAsStaff(endpoints.allowlistBulk, { text }),
    onSuccess: async (result) => {
      // Only what was refused stays in the box, so it can be fixed and sent again.
      setText(result.errors.map((error) => error.text).join("\n"));
      await refresh();
    },
  });
  const result = bulk.data;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        bulk.mutate();
      }}
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
    >
      <h2 className="text-base font-semibold">{t("allowlist.bulk.title")}</h2>
      <Field
        id="allowlist-bulk"
        label={t("allowlist.bulk.label")}
        hint={t("allowlist.bulk.hint", { max: MAX_BULK_LINES })}
        error={bulk.isError ? apiErrorMessage(t, bulk.error) : undefined}
      >
        <Textarea
          {...describedBy("allowlist-bulk", { hint: true, error: bulk.isError })}
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          required
        />
      </Field>
      <div>
        <Button type="submit" disabled={bulk.isPending}>
          {bulk.isPending ? t("allowlist.bulk.submitting") : t("allowlist.bulk.submit")}
        </Button>
      </div>
      {result ? (
        <Alert
          variant={result.errors.length > 0 ? "attention" : "neutral"}
          role="status"
          title={t("allowlist.bulk.result.title")}
        >
          <p>
            {t("allowlist.bulk.result.summary", {
              added: result.added.length,
              refused: result.errors.length,
            })}
          </p>
          {result.errors.length > 0 ? (
            <ul className="list-disc pl-5 [overflow-wrap:anywhere]" data-bulk-errors="">
              {result.errors.map((error) => (
                <li key={error.line}>
                  {t("allowlist.bulk.result.line", { line: error.line, text: error.text })}
                  {" — "}
                  {t(`allowlist.bulk.error.${error.code}`)}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
    </form>
  );
}

function EntryRow({ entry }: { entry: AllowlistEntry }) {
  const t = useT();
  const format = useFormatter();
  const refresh = useRefresh();
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const [note, setNote] = useState(entry.note ?? "");
  const save = useMutation({
    mutationFn: () => callAsStaff(endpoints.allowlistNote, { email: entry.email, note }),
    onSuccess: async () => {
      await refresh();
      setMode("view");
    },
  });
  const remove = useMutation({
    mutationFn: () => callAsStaff(endpoints.allowlistRemove, { email: entry.email }),
    onSuccess: refresh,
  });
  const noteId = `note-${entry.email}`;

  return (
    <li
      className="flex flex-col gap-2 border-t border-border-subtle px-4 py-3 first:border-t-0"
      data-allowlist-entry={entry.email}
    >
      <div className="grid gap-x-4 gap-y-1 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_auto]">
        <span className="font-medium break-all">{entry.email}</span>
        {mode === "edit" ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <label htmlFor={noteId} className="sr-only">
              {t("allowlist.note.label", { email: entry.email })}
            </label>
            <Input
              id={noteId}
              className="min-w-0 flex-1"
              maxLength={MAX_NOTE_LENGTH}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={save.isPending}>
              {t("allowlist.note.save")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setNote(entry.note ?? "");
                setMode("view");
              }}
            >
              {t("allowlist.note.cancel")}
            </Button>
            {save.isError ? (
              <p className="w-full text-xs font-medium text-danger">
                {apiErrorMessage(t, save.error)}
              </p>
            ) : null}
          </form>
        ) : (
          <span className={entry.note ? "break-words" : "text-muted-foreground"}>
            {entry.note ?? t("allowlist.note.none")}
          </span>
        )}
        <span className="text-sm text-muted-foreground">
          {t("allowlist.addedBy", { login: entry.addedBy, date: format.date(entry.addedAt) })}
        </span>
        <span className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${t("allowlist.note.edit")}: ${entry.email}`}
            onClick={() => setMode("edit")}
          >
            {t("allowlist.note.edit")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${t("allowlist.remove")}: ${entry.email}`}
            onClick={() => setMode("remove")}
          >
            {t("allowlist.remove")}
          </Button>
        </span>
      </div>
      {mode === "remove" ? (
        <Alert
          variant="danger"
          role="alert"
          title={t("allowlist.remove.title", { email: entry.email })}
        >
          <p>{t("allowlist.remove.description")}</p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t("allowlist.remove.confirm")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setMode("view")}>
              {t("allowlist.remove.cancel")}
            </Button>
          </div>
          {remove.isError ? (
            <p className="font-medium text-danger">{apiErrorMessage(t, remove.error)}</p>
          ) : null}
        </Alert>
      ) : null}
    </li>
  );
}

/**
 * The Allowlist screen (SPEC 2.4, 5), System admin only: search, add one, add many with a per-line result,
 * edit a note, and remove after a confirmation. Changes take about a minute to apply (KV), and the screen says so.
 */
export function Component() {
  const t = useT();
  const { displayName } = usePublicConfig();
  useDocumentTitle(t("allowlist.title"), displayName);
  const [search, setSearch] = useState("");
  const list = useQuery(allowlistQuery);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (list.data?.entries ?? []).filter(
      (entry) =>
        needle === "" ||
        entry.email.includes(needle) ||
        (entry.note ?? "").toLowerCase().includes(needle),
    );
  }, [list.data, search]);

  let body;
  if (list.isPending) body = <Loading text={t("allowlist.loading")} />;
  else if (list.isError) {
    body = (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <h2 className="text-base font-semibold">{t("allowlist.error.title")}</h2>
        <p className="text-muted-foreground">{apiErrorMessage(t, list.error)}</p>
        <Button variant="secondary" onClick={() => void list.refetch()}>
          {t("boot.retry")}
        </Button>
      </div>
    );
  } else if (list.data.entries.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
        <h2 className="text-base font-semibold">{t("allowlist.empty.title")}</h2>
        <p className="text-muted-foreground">{t("allowlist.empty.description")}</p>
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <p className="px-4 py-8 text-center text-muted-foreground">{t("allowlist.noMatches")}</p>
    );
  } else {
    body = (
      <ul>
        {visible.map((entry) => (
          <EntryRow key={entry.email} entry={entry} />
        ))}
      </ul>
    );
  }

  return (
    <RequireAdmin>
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("allowlist.title")}</h1>
        <p className="text-muted-foreground">{t("allowlist.intro")}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <AddOne />
          <AddMany />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full max-w-sm">
            <Field id="allowlist-search" label={t("allowlist.search.label")}>
              <Input
                id="allowlist-search"
                type="search"
                autoComplete="off"
                placeholder={t("allowlist.search.placeholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
          </div>
          {list.data ? (
            <span className="pb-3 text-xs text-muted-foreground">
              {t("allowlist.count", { count: visible.length })}
            </span>
          ) : null}
        </div>
        <div className="overflow-hidden rounded-md border">{body}</div>
      </div>
    </RequireAdmin>
  );
}
