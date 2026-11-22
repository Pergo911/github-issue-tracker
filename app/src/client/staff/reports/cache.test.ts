import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { GitHubIssue, GitHubTimelineEvent, GitHubUser } from "@shared/github/types.ts";
import {
  patchIssueInCaches,
  setAssigneeOptimistically,
  setDimensionOptimistically,
} from "./cache.ts";
import { reportDetailQuery, reportSearchQuery, reportsQuery } from "./queries.ts";

const repo = { owner: "o", name: "r" };

function issue(
  number: number,
  labels: string[],
  assignees: string[] = [],
  title = `R${number}`,
): GitHubIssue {
  return {
    number,
    title,
    state: "open",
    state_reason: null,
    created_at: `2026-01-0${number}T00:00:00Z`,
    updated_at: `2026-01-0${number}T00:00:00Z`,
    closed_at: null,
    labels: labels.map((name) => ({ name, color: "ededed" })),
    assignee: assignees[0] ? ({ login: assignees[0] } as GitHubUser) : null,
    assignees: assignees.map((login) => ({ login }) as GitHubUser),
  } as unknown as GitHubIssue;
}

describe("setDimensionOptimistically", () => {
  it("swaps only the target dimension and preserves metadata on kept labels", () => {
    const base = issue(1, ["category:plumbing", "priority:low", "status:new"]);
    const updated = setDimensionOptimistically(base, "category", "electrical");
    expect(updated.labels.map((l) => l.name)).toEqual([
      "priority:low",
      "status:new",
      "category:electrical",
    ]);
    expect(updated.labels[0]).toBe(base.labels[1]);
  });
});

describe("setAssigneeOptimistically", () => {
  it("sets an assignee from known assignable users and clears it when null", () => {
    const base = issue(1, ["status:new"]);
    const assignable = [{ login: "tamas-triage", id: 42 } as GitHubUser];
    const assigned = setAssigneeOptimistically(base, "tamas-triage", assignable);
    expect(assigned.assignees).toEqual(assignable);
    expect(assigned.assignee).toEqual(assignable[0]);

    const cleared = setAssigneeOptimistically(assigned, null, assignable);
    expect(cleared.assignees).toEqual([]);
    expect(cleared.assignee).toBeNull();
  });
});

describe("patchIssueInCaches", () => {
  it("patches list, active search, and cached detail (preserving timeline) without inventing missing caches", () => {
    const queryClient = new QueryClient();
    const initial1 = issue(1, ["status:new"], [], "Leaking tap");
    const initial2 = issue(2, ["status:new"], [], "Broken lift");
    const updated1 = issue(1, ["status:in-progress"], ["tamas-triage"], "Leaking tap");
    const timeline = [{ event: "labeled" }] as unknown as GitHubTimelineEvent[];

    queryClient.setQueryData(reportsQuery(repo).queryKey, [initial1, initial2]);
    queryClient.setQueryData(reportSearchQuery(repo, "tap").queryKey, [initial1]);
    queryClient.setQueryData(reportDetailQuery(repo, 1).queryKey, { issue: initial1, timeline });

    patchIssueInCaches(queryClient, repo, updated1);

    expect(queryClient.getQueryData(reportsQuery(repo).queryKey)).toEqual([updated1, initial2]);
    expect(queryClient.getQueryData(reportSearchQuery(repo, "tap").queryKey)).toEqual([updated1]);
    expect(queryClient.getQueryData(reportDetailQuery(repo, 1).queryKey)).toEqual({
      issue: updated1,
      timeline,
    });
    expect(queryClient.getQueryData(reportDetailQuery(repo, 2).queryKey)).toBeUndefined();
  });
});
