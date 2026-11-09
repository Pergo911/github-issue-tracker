import { DIMENSIONS, type Dimension } from "@shared/config/schema.ts";
import type { PublicConfig } from "@shared/config/public.ts";
import type { GitHubIssue } from "@shared/github/types.ts";

type Taxonomy = PublicConfig["taxonomy"];

/** One label pill: a configured value with its display name and colour, or an unknown one by its raw name. */
export interface Pill {
  dimension: Dimension;
  /** The display name, or the raw `dimension:value` identifier for a value the configuration does not know. */
  text: string;
  /** Six hex digits, or `null` for the fixed neutral grey. */
  color: string | null;
  unknown: boolean;
}

/** Why an open Report's Status needs correction (SPEC 2.4): none, several, or an obsolete value. */
export type StatusProblem = "none" | "multiple" | "obsolete";

/** What the List shows of one Report, read from its GitHub issue and the configured taxonomy. */
export interface ReportRow {
  number: number;
  title: string;
  state: "open" | "closed";
  /** For a closed Report: fixed (`completed` or none) or rejected (`not_planned`, `duplicate`). */
  closedKind: "fixed" | "rejected" | null;
  createdAt: string;
  assignees: string[];
  /** The configured value ids; `null` when absent or not configured. Status counts only when it is valid. */
  category: string | null;
  location: string | null;
  priority: string | null;
  status: string | null;
  statusProblem: StatusProblem | null;
  pills: Pill[];
}

function parseLabel(name: string): { dimension: Dimension; id: string } | null {
  const colon = name.indexOf(":");
  if (colon === -1) return null;
  const dimension = name.slice(0, colon);
  const found = DIMENSIONS.find((candidate) => candidate === dimension);
  return found ? { dimension: found, id: name.slice(colon + 1) } : null;
}

/**
 * Turns an issue into a row. Unrelated labels are ignored; a value the configuration does not know shows its raw
 * identifier; an open Report without exactly one configured Status carries a `statusProblem` instead of being
 * hidden or given an invented Status. A closed Report ignores any stale Status label (SPEC 2.3, 2.4).
 */
export function toReportRow(issue: GitHubIssue, taxonomy: Taxonomy): ReportRow {
  const closed = issue.state === "closed";
  const found: Record<Dimension, string[]> = {
    category: [],
    location: [],
    priority: [],
    status: [],
  };
  const pills: Pill[] = [];
  for (const { name } of issue.labels) {
    const parsed = parseLabel(name);
    if (!parsed) continue;
    if (parsed.dimension === "status" && closed) continue;
    const value = taxonomy[parsed.dimension].find((candidate) => candidate.id === parsed.id);
    found[parsed.dimension].push(parsed.id);
    pills.push(
      value
        ? {
            dimension: parsed.dimension,
            text: value.name,
            color: value.color ?? null,
            unknown: false,
          }
        : { dimension: parsed.dimension, text: name, color: null, unknown: true },
    );
  }
  const known = (dimension: Dimension): string | null =>
    found[dimension].find((id) => taxonomy[dimension].some((value) => value.id === id)) ?? null;

  let status: string | null = null;
  let statusProblem: StatusProblem | null = null;
  if (!closed) {
    const statuses = found.status;
    if (statuses.length === 0) statusProblem = "none";
    else if (statuses.length > 1) statusProblem = "multiple";
    else if (known("status") === null) statusProblem = "obsolete";
    else status = statuses[0] ?? null;
  }

  return {
    number: issue.number,
    title: issue.title,
    state: closed ? "closed" : "open",
    closedKind: closed
      ? issue.state_reason === "not_planned" || issue.state_reason === "duplicate"
        ? "rejected"
        : "fixed"
      : null,
    createdAt: issue.created_at,
    assignees: issue.assignees.map((assignee) => assignee.login),
    category: known("category"),
    location: known("location"),
    priority: known("priority"),
    status,
    statusProblem,
    pills,
  };
}

/** The List's order (SPEC 2.4): the most urgent configured Priority first, untriaged last, then oldest first. */
export function sortReports(rows: readonly ReportRow[], taxonomy: Taxonomy): ReportRow[] {
  // The configuration lists Priorities lowest first, so a later index is more urgent.
  const rank = (row: ReportRow) =>
    row.priority === null ? -1 : taxonomy.priority.findIndex((value) => value.id === row.priority);
  return [...rows].sort(
    (a, b) =>
      rank(b) - rank(a) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.number - b.number,
  );
}

export interface ReportFilters {
  /** `any` is for a search, which looks across the whole history. */
  state: "open" | "closed" | "any";
  category?: string | undefined;
  location?: string | undefined;
  priority?: string | undefined;
  status?: string | undefined;
  assignee?: string | undefined;
  untriaged?: boolean | undefined;
}

/** Client-side filtering over the fetched Reports (SPEC 2.4). Every given filter must match. */
export function filterReports(rows: readonly ReportRow[], filters: ReportFilters): ReportRow[] {
  return rows.filter(
    (row) =>
      (filters.state === "any" || row.state === filters.state) &&
      (filters.category === undefined || row.category === filters.category) &&
      (filters.location === undefined || row.location === filters.location) &&
      (filters.priority === undefined || row.priority === filters.priority) &&
      (filters.status === undefined || row.status === filters.status) &&
      (filters.assignee === undefined || row.assignees.includes(filters.assignee)) &&
      (filters.untriaged !== true || row.priority === null),
  );
}
