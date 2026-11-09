import { describe, expect, it } from "vitest";
import { configSchema } from "@shared/config/schema.ts";
import { toPublicConfig } from "@shared/config/public.ts";
import { referenceConfig } from "@shared/seed/reference-config.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import {
  filterReports,
  sortByLastReporterComment,
  sortReports,
  toReportRow,
  type ReportFilters,
  type ReportRow,
} from "./model.ts";

const taxonomy = toPublicConfig(configSchema.parse(referenceConfig)).taxonomy;

let nextNumber = 1;
function issue(
  labels: string[],
  extra: Partial<{
    title: string;
    state: "open" | "closed";
    state_reason: GitHubIssue["state_reason"];
    created_at: string;
    assignees: string[];
    pull_request: boolean;
  }> = {},
): GitHubIssue {
  const number = nextNumber++;
  return {
    number,
    title: extra.title ?? `Report ${number}`,
    state: extra.state ?? "open",
    state_reason: extra.state_reason ?? null,
    created_at: extra.created_at ?? "2026-01-01T00:00:00Z",
    labels: labels.map((name) => ({ name, color: "ededed" })),
    assignees: (extra.assignees ?? []).map((login) => ({ login })),
    ...(extra.pull_request ? { pull_request: {} } : {}),
  } as unknown as GitHubIssue;
}

const row = (labels: string[], extra: Parameters<typeof issue>[1] = {}): ReportRow =>
  toReportRow(issue(labels, extra), taxonomy);

describe("toReportRow", () => {
  it("reads the four dimensions from the labels, with the configured names and colours", () => {
    const report = row([
      "category:plumbing",
      "location:floor-2",
      "priority:high",
      "status:in-progress",
    ]);
    expect(report.category).toBe("plumbing");
    expect(report.location).toBe("floor-2");
    expect(report.priority).toBe("high");
    expect(report.status).toBe("in-progress");
    expect(report.statusProblem).toBeNull();
    expect(report.pills.map((pill) => pill.text)).toEqual([
      "Víz- és csatornahiba",
      "2. emelet",
      "Magas",
      "Folyamatban",
    ]);
    expect(report.pills[0]?.color).toBe("0075ca");
  });

  it("ignores unrelated labels, and shows an unknown value of a dimension by its raw identifier", () => {
    const report = row(["bug", "category:legacy", "category:plumbing", "status:new"]);
    expect(report.pills.map((pill) => pill.text)).toEqual([
      "category:legacy",
      "Víz- és csatornahiba",
      "Új",
    ]);
    expect(report.pills[0]).toMatchObject({ unknown: true, color: null });
    expect(report.pills.some((pill) => pill.text === "bug")).toBe(false);
  });

  it.each([
    ["no Status", ["category:plumbing"], "none"],
    ["several Statuses", ["status:new", "status:on-hold"], "multiple"],
    ["an obsolete Status", ["status:retired"], "obsolete"],
  ] as const)("flags an open Report with %s, and keeps it", (_name, labels, problem) => {
    const report = row([...labels]);
    expect(report.statusProblem).toBe(problem);
    expect(report.status).toBeNull();
  });

  it("does not flag a closed Report, and ignores its stale Status label", () => {
    const report = row(["status:in-progress", "category:elevator"], {
      state: "closed",
      state_reason: "completed",
    });
    expect(report.statusProblem).toBeNull();
    expect(report.pills.map((pill) => pill.text)).toEqual(["Lift"]);
    expect(report.closedKind).toBe("fixed");
  });

  it.each([
    ["completed", "fixed"],
    [null, "fixed"],
    ["not_planned", "rejected"],
    ["duplicate", "rejected"],
  ] as const)("counts a closed Report with reason %s as %s", (reason, kind) => {
    expect(row([], { state: "closed", state_reason: reason }).closedKind).toBe(kind);
  });

  it("carries the number, title, creation time and assignee logins", () => {
    const report = row([], { title: "Lift", assignees: ["mate-maintenance"] });
    expect(report).toMatchObject({ title: "Lift", assignees: ["mate-maintenance"] });
    expect(report.createdAt).toBe("2026-01-01T00:00:00Z");
  });
});

describe("sortReports", () => {
  it("orders by the configured Priority (most urgent first, untriaged last), then oldest first", () => {
    const reports = [
      row(["priority:low"], { created_at: "2026-01-01T00:00:00Z", title: "low-old" }),
      row([], { created_at: "2025-01-01T00:00:00Z", title: "untriaged-oldest" }),
      row(["priority:urgent"], { created_at: "2026-03-01T00:00:00Z", title: "urgent-new" }),
      row(["priority:urgent"], { created_at: "2026-02-01T00:00:00Z", title: "urgent-old" }),
      row(["priority:high"], { created_at: "2026-01-15T00:00:00Z", title: "high" }),
      row(["priority:retired"], { created_at: "2026-01-01T00:00:00Z", title: "unknown-priority" }),
    ];
    expect(sortReports(reports, taxonomy).map((report) => report.title)).toEqual([
      "urgent-old",
      "urgent-new",
      "high",
      "low-old",
      "untriaged-oldest",
      "unknown-priority",
    ]);
  });

  it("does not mutate its input", () => {
    const reports = [row(["priority:low"]), row(["priority:urgent"])];
    const copy = [...reports];
    sortReports(reports, taxonomy);
    expect(reports).toEqual(copy);
  });
});

describe("filterReports", () => {
  const none: ReportFilters = { state: "open" };
  const reports = [
    row(["category:plumbing", "location:floor-2", "status:new"], { assignees: ["a"] }),
    row(["category:elevator", "location:elevator", "priority:high", "status:on-hold"]),
    row(["category:plumbing", "priority:low", "status:new"], { assignees: ["b"] }),
    row(["category:plumbing"], { state: "closed", state_reason: "completed" }),
    row(["status:retired"]),
  ];

  it("shows open Reports by default, closed ones on request, and never drops an invalid-Status Report", () => {
    expect(filterReports(reports, none)).toHaveLength(4);
    expect(filterReports(reports, { state: "closed" })).toHaveLength(1);
    expect(filterReports(reports, none).some((report) => report.statusProblem === "obsolete")).toBe(
      true,
    );
  });

  it("shows open and closed together when asked for any state (a search spans the whole history)", () => {
    expect(filterReports(reports, { state: "any" })).toHaveLength(5);
  });

  it("narrows by each dimension, the assignee and untriaged, all together", () => {
    expect(filterReports(reports, { ...none, category: "plumbing" })).toHaveLength(2);
    expect(filterReports(reports, { ...none, location: "elevator" })).toHaveLength(1);
    expect(filterReports(reports, { ...none, priority: "high" })).toHaveLength(1);
    expect(filterReports(reports, { ...none, status: "new" })).toHaveLength(2);
    expect(filterReports(reports, { ...none, assignee: "b" })).toHaveLength(1);
    expect(filterReports(reports, { ...none, untriaged: true })).toHaveLength(2);
    expect(
      filterReports(reports, { ...none, category: "plumbing", status: "new", untriaged: true }),
    ).toHaveLength(1);
  });
});

describe("Reporter-comment filter and sort", () => {
  const a = row(["status:new"]);
  const b = row(["status:new"]);
  const c = row(["status:new"]);
  const scan = {
    [a.number]: { count: 1, last: "2026-03-01T00:00:00Z" },
    [b.number]: { count: 2, last: "2026-03-09T00:00:00Z" },
  };

  it("keeps only Reports the scan found Reporter comments on", () => {
    const kept = filterReports([a, b, c], { state: "open", reporterComments: scan });
    expect(kept.map((r) => r.number)).toEqual([a.number, b.number]);
  });

  it("leaves everything when the filter is off", () => {
    expect(filterReports([a, b, c], { state: "open" })).toHaveLength(3);
  });

  it("sorts the latest Reporter comment first, Reports without one last", () => {
    expect(sortByLastReporterComment([c, a, b], scan).map((r) => r.number)).toEqual([
      b.number,
      a.number,
      c.number,
    ]);
  });
});
