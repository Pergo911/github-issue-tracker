import { SearchIcon, SyncIcon, XIcon } from "@primer/octicons-react";
import { useState } from "react";
import type { PublicConfig } from "@shared/config/public.ts";
import { useT } from "@/i18n/context.tsx";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/ui/button.tsx";
import type { ListView } from "./view-state.ts";

type Dimension = "category" | "location" | "priority" | "status";
const DIMENSIONS: readonly Dimension[] = ["category", "location", "priority", "status"];
const DIMENSION_LABEL: Record<
  Dimension,
  | "reports.filter.category"
  | "reports.filter.location"
  | "reports.filter.priority"
  | "reports.filter.status"
> = {
  category: "reports.filter.category",
  location: "reports.filter.location",
  priority: "reports.filter.priority",
  status: "reports.filter.status",
};

const chip =
  "inline-flex h-7 items-center gap-1.5 rounded-md border border-secondary-border bg-secondary px-2 text-xs text-secondary-foreground";

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: readonly { value: string; text: string }[];
  onChange: (value: string | undefined) => void;
}) {
  const t = useT();
  return (
    <label className={cn(chip, value !== undefined && "border-accent-emphasis bg-accent-muted")}>
      <span className="font-medium">{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        className="max-w-40 bg-transparent text-xs"
      >
        <option value="">{t("reports.filter.all")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The search box. Keyed by the URL's search text, so it starts over whenever the URL changes it. */
function SearchBox({ initial, onSearch }: { initial: string; onSearch: (text: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(initial);
  return (
    <form
      role="search"
      className="flex min-w-0 grow gap-2 md:max-w-lg"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft.trim());
      }}
    >
      <label className="relative min-w-0 grow">
        <span className="sr-only">{t("reports.search.label")}</span>
        <SearchIcon
          size={16}
          className="pointer-events-none absolute top-2 left-2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("reports.search.placeholder")}
          className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-8 text-sm"
        />
      </label>
      <Button type="submit" variant="secondary">
        {t("reports.search.submit")}
      </Button>
    </form>
  );
}

/** Search, the open/closed toggle, the filter chips and the refresh control of the List (SPEC 2.4). */
export function FilterBar({
  view,
  taxonomy,
  assignees,
  refreshing,
  scan,
  onChange,
  onRefresh,
  onCheckReporter,
}: {
  /** The Reporter-comment scan: not run yet, running, failed or done (SPEC 2.4). */
  scan: "unknown" | "loading" | "error" | "ready";
  onCheckReporter: () => void;
  view: ListView;
  taxonomy: PublicConfig["taxonomy"];
  assignees: readonly string[];
  refreshing: boolean;
  onChange: (patch: Partial<Record<keyof ListView, string | boolean | undefined>>) => void;
  onRefresh: () => void;
}) {
  const t = useT();
  const filtered =
    DIMENSIONS.some((key) => view[key] !== undefined) ||
    view.assignee !== undefined ||
    view.untriaged === true ||
    view.reporter === true ||
    view.sort !== undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox key={view.q} initial={view.q} onSearch={(q) => onChange({ q })} />
        <Button variant="secondary" onClick={onRefresh} disabled={refreshing}>
          <SyncIcon size={16} aria-hidden="true" />
          {refreshing ? t("reports.refreshing") : t("reports.refresh")}
        </Button>
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t("reports.filter.label")}
      >
        {DIMENSIONS.map((dimension) => (
          <FilterSelect
            key={dimension}
            label={t(DIMENSION_LABEL[dimension])}
            value={view[dimension]}
            options={taxonomy[dimension].map((value) => ({ value: value.id, text: value.name }))}
            onChange={(value) => onChange({ [dimension]: value })}
          />
        ))}
        <FilterSelect
          label={t("reports.filter.assignee")}
          value={view.assignee}
          options={[...new Set([...assignees, ...(view.assignee ? [view.assignee] : [])])]
            .sort()
            .map((login) => ({ value: login, text: login }))}
          onChange={(value) => onChange({ assignee: value })}
        />
        <button
          type="button"
          aria-pressed={view.untriaged === true}
          onClick={() => onChange({ untriaged: view.untriaged ? undefined : true })}
          className={cn(chip, view.untriaged && "border-accent-emphasis bg-accent-muted")}
        >
          {t("reports.filter.untriaged")}
        </button>
        <button
          type="button"
          aria-pressed={view.reporter === true}
          onClick={() => onChange({ reporter: view.reporter ? undefined : true })}
          className={cn(chip, view.reporter && "border-accent-emphasis bg-accent-muted")}
        >
          {t("reports.filter.reporter")}
        </button>
        <label
          className={cn(chip, view.sort !== undefined && "border-accent-emphasis bg-accent-muted")}
        >
          <span className="font-medium">{t("reports.sort.label")}</span>
          <select
            value={view.sort ?? ""}
            onChange={(event) =>
              onChange({ sort: event.target.value === "" ? undefined : event.target.value })
            }
            className="max-w-48 bg-transparent text-xs"
          >
            <option value="">{t("reports.sort.default")}</option>
            <option value="reporter">{t("reports.sort.reporter")}</option>
          </select>
        </label>
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                category: undefined,
                location: undefined,
                priority: undefined,
                status: undefined,
                assignee: undefined,
                untriaged: undefined,
                reporter: undefined,
                sort: undefined,
              })
            }
          >
            <XIcon size={12} aria-hidden="true" />
            {t("reports.filter.clear")}
          </Button>
        ) : null}
      </div>
      {scan === "unknown" ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {t("reports.reporter.unknown")}
          <Button variant="secondary" size="sm" onClick={onCheckReporter}>
            {t("reports.reporter.check")}
          </Button>
        </p>
      ) : null}
    </div>
  );
}
