import { describe, expect, it } from "vitest";
import { configSchema } from "@shared/config/schema.ts";
import { toPublicConfig } from "@shared/config/public.ts";
import { referenceConfig } from "@shared/seed/reference-config.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import { boardColumns, CORRECTION_COLUMN, moveOptimistically } from "./board-model.ts";
import { toReportRow } from "./model.ts";

const taxonomy = toPublicConfig(configSchema.parse(referenceConfig)).taxonomy;

function issue(number: number, labels: string[], state: "open" | "closed" = "open"): GitHubIssue {
  return {
    number,
    title: `R${number}`,
    state,
    state_reason: null,
    created_at: `2026-01-0${number}T00:00:00Z`,
    labels: labels.map((name) => ({ name, color: "ededed" })),
    assignees: [],
  } as unknown as GitHubIssue;
}
const rows = (issues: GitHubIssue[]) => issues.map((i) => toReportRow(i, taxonomy));

describe("boardColumns", () => {
  const statuses = taxonomy.status.map((value) => value.id);

  it("has one column per configured Status in order, then the correction column, always present", () => {
    const columns = boardColumns([], taxonomy);
    expect(columns.map((c) => c.id)).toEqual([...statuses, CORRECTION_COLUMN]);
    expect(columns.every((c) => c.rows.length === 0)).toBe(true);
  });

  it("places open Reports by Status, and a Report with an invalid Status in the correction column", () => {
    const columns = boardColumns(
      rows([
        issue(1, [`status:${statuses[0]}`]),
        issue(2, []),
        issue(3, [`status:${statuses[0]}`, `status:${statuses[1]}`]),
        issue(4, ["status:retired"]),
        issue(5, [`status:${statuses[1]}`], "closed"),
      ]),
      taxonomy,
    );
    const ids = (id: string) => columns.find((c) => c.id === id)?.rows.map((r) => r.number);
    expect(ids(statuses[0]!)).toEqual([1]);
    expect(ids(CORRECTION_COLUMN)).toEqual([2, 3, 4]);
    expect(ids(statuses[1]!)).toEqual([]);
  });

  it("orders each column by Priority then oldest first", () => {
    const [first] = boardColumns(
      rows([
        issue(1, [`status:${statuses[0]}`, "priority:low"]),
        issue(2, [`status:${statuses[0]}`, "priority:high"]),
        issue(3, [`status:${statuses[0]}`, "priority:high"]),
      ]),
      taxonomy,
    );
    expect(first?.rows.map((r) => r.number)).toEqual([2, 3, 1]);
  });
});

describe("moveOptimistically", () => {
  it("swaps only the Status label of the one issue and leaves the rest", () => {
    const issues = [issue(1, ["category:elevator", "status:new", "x"]), issue(2, ["status:new"])];
    const moved = moveOptimistically(issues, 1, "in-progress");
    expect(moved[0]?.labels.map((l) => l.name)).toEqual([
      "category:elevator",
      "x",
      "status:in-progress",
    ]);
    expect(moved[1]).toBe(issues[1]);
  });
});
