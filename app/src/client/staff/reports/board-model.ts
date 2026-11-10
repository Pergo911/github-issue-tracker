import type { PublicConfig } from "@shared/config/public.ts";
import type { GitHubIssue, GitHubLabel } from "@shared/github/types.ts";
import { setDimension } from "@shared/reports/labels.ts";
import { sortReports, type ReportRow } from "./model.ts";

type Taxonomy = PublicConfig["taxonomy"];

/** The id of the column for open Reports whose Status is missing, doubled or no longer configured (SPEC 2.4). */
export const CORRECTION_COLUMN = "needs-correction";

export interface BoardColumn {
  /** A configured Status id, or `CORRECTION_COLUMN`. */
  id: string;
  rows: ReportRow[];
}

/**
 * One column per configured Status in order, plus the correction column, each holding the open Reports it
 * belongs to in the List's order. Every column is always there, empty or not; a Report is in exactly one.
 */
export function boardColumns(rows: readonly ReportRow[], taxonomy: Taxonomy): BoardColumn[] {
  const open = rows.filter((row) => row.state === "open");
  const inColumn = (id: string) =>
    sortReports(
      open.filter((row) => row.status === id),
      taxonomy,
    );
  return [
    ...taxonomy.status.map((value) => ({ id: value.id, rows: inColumn(value.id) })),
    {
      id: CORRECTION_COLUMN,
      rows: sortReports(
        open.filter((row) => row.statusProblem !== null),
        taxonomy,
      ),
    },
  ];
}

/** The fetched issues with one Report's Status swapped: the optimistic move, which touches only that card. */
export function moveOptimistically(
  issues: readonly GitHubIssue[],
  number: number,
  status: string,
): GitHubIssue[] {
  return issues.map((issue) => {
    if (issue.number !== number) return issue;
    const names = setDimension(
      issue.labels.map((label) => label.name),
      "status",
      status,
    );
    const known = new Map(issue.labels.map((label) => [label.name, label]));
    return {
      ...issue,
      labels: names.map((name) => known.get(name) ?? ({ name } as GitHubLabel)),
    };
  });
}
