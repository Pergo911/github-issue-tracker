import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitHubComment,
  GitHubIssue,
  GitHubTimelineEvent,
  GitHubUser,
} from "@shared/github/types.ts";
import {
  appendCommentToDetailCache,
  clearConfirmedComments,
  mergeConfirmedComments,
  patchIssueInCaches,
  setAssigneeOptimistically,
  setDimensionOptimistically,
} from "./cache.ts";
import { reportDetailQuery, reportSearchQuery, reportsQuery } from "./queries.ts";

afterEach(() => {
  clearConfirmedComments();
});

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

function comment(id: number, body: string, at: string, login = "tamas-triage"): GitHubComment {
  return {
    id,
    node_id: `IC_${id}`,
    url: `https://api.github.test/repos/o/r/issues/comments/${id}`,
    html_url: `https://github.test/o/r/issues/1#issuecomment-${id}`,
    issue_url: "https://api.github.test/repos/o/r/issues/1",
    body,
    created_at: at,
    updated_at: at,
    author_association: "COLLABORATOR",
    performed_via_github_app: null,
    user: { login, id: 7, type: "User" } as GitHubUser,
  };
}

describe("appendCommentToDetailCache and mergeConfirmedComments", () => {
  it("appends a created comment to detail, deduplicates by id, and bumps list/search caches", () => {
    const queryClient = new QueryClient();
    const base = { ...issue(1, ["status:new"]), comments: 0 };
    const other = { ...issue(2, ["status:new"]), comments: 0 };
    const existingTimeline = [{ event: "labeled" }] as unknown as GitHubTimelineEvent[];

    queryClient.setQueryData(reportsQuery(repo).queryKey, [base, other]);
    queryClient.setQueryData(reportSearchQuery(repo, "R1").queryKey, [base]);
    queryClient.setQueryData(reportDetailQuery(repo, 1).queryKey, {
      issue: base,
      timeline: existingTimeline,
    });

    const created = comment(101, "On the way", "2026-01-05T12:00:00Z");
    appendCommentToDetailCache(queryClient, repo, 1, created, () => 1_000);

    const detail = queryClient.getQueryData(reportDetailQuery(repo, 1).queryKey);
    expect(detail?.issue.comments).toBe(1);
    expect(detail?.issue.updated_at).toBe("2026-01-05T12:00:00Z");
    expect(detail?.timeline).toHaveLength(2);
    expect(detail?.timeline[1]).toMatchObject({
      ...created,
      event: "commented",
      actor: created.user,
    });

    expect(queryClient.getQueryData(reportsQuery(repo).queryKey)?.[0]).toMatchObject({
      comments: 1,
      updated_at: "2026-01-05T12:00:00Z",
    });
    expect(queryClient.getQueryData(reportsQuery(repo).queryKey)?.[1]?.comments).toBe(0);
    expect(queryClient.getQueryData(reportSearchQuery(repo, "R1").queryKey)?.[0]?.comments).toBe(1);

    // Calling again with the same comment id is a no-op (no duplicate timeline row or count bump).
    appendCommentToDetailCache(queryClient, repo, 1, created, () => 2_000);
    expect(queryClient.getQueryData(reportDetailQuery(repo, 1).queryKey)?.timeline).toHaveLength(2);
    expect(queryClient.getQueryData(reportDetailQuery(repo, 1).queryKey)?.issue.comments).toBe(1);
    expect(queryClient.getQueryData(reportsQuery(repo).queryKey)?.[0]?.comments).toBe(1);
  });

  it("does not overwrite updated_at with an older comment timestamp", () => {
    const queryClient = new QueryClient();
    const base = {
      ...issue(1, ["status:new"]),
      comments: 0,
      updated_at: "2026-02-01T00:00:00Z",
    };
    queryClient.setQueryData(reportDetailQuery(repo, 1).queryKey, { issue: base, timeline: [] });

    appendCommentToDetailCache(
      queryClient,
      repo,
      1,
      comment(102, "Older", "2026-01-10T00:00:00Z"),
      () => 1_000,
    );
    expect(queryClient.getQueryData(reportDetailQuery(repo, 1).queryKey)?.issue.updated_at).toBe(
      "2026-02-01T00:00:00Z",
    );
  });

  it("preserves missing confirmed comments across stale refetches, evicts once fetched, and expires after 60 s", () => {
    const queryClient = new QueryClient();
    const base = { ...issue(1, ["status:new"]), comments: 0 };
    queryClient.setQueryData(reportDetailQuery(repo, 1).queryKey, { issue: base, timeline: [] });

    let now = 10_000;
    const created = comment(201, "Fresh comment", "2026-01-05T12:00:00Z");
    appendCommentToDetailCache(queryClient, repo, 1, created, () => now);

    // Stale refetch missing the comment preserves it and bumps counts/updated_at.
    const mergedStale = mergeConfirmedComments(
      repo,
      1,
      { issue: { ...base, comments: 0 }, timeline: [] },
      () => now + 5_000,
    );
    expect(mergedStale.timeline).toHaveLength(1);
    expect(mergedStale.timeline[0]).toMatchObject({ id: 201, event: "commented" });
    expect(mergedStale.issue.comments).toBe(1);
    expect(mergedStale.issue.updated_at).toBe("2026-01-05T12:00:00Z");

    // Once GitHub returns the comment, it is evicted so a later deletion never resurrects it.
    const mergedFresh = mergeConfirmedComments(
      repo,
      1,
      {
        issue: { ...base, comments: 1, updated_at: "2026-01-05T12:00:00Z" },
        timeline: [{ ...created, event: "commented", actor: created.user }],
      },
      () => now + 6_000,
    );
    expect(mergedFresh.timeline).toHaveLength(1);

    const afterDelete = mergeConfirmedComments(
      repo,
      1,
      { issue: { ...base, comments: 0 }, timeline: [] },
      () => now + 7_000,
    );
    expect(afterDelete.timeline).toHaveLength(0);

    // Entries also expire after 60 s even if never observed in a refetch.
    const c2 = comment(202, "Expiring", "2026-01-05T12:05:00Z");
    appendCommentToDetailCache(queryClient, repo, 1, c2, () => now);
    now += 60_000;
    const expired = mergeConfirmedComments(
      repo,
      1,
      { issue: { ...base, comments: 0 }, timeline: [] },
      () => now,
    );
    expect(expired.timeline).toHaveLength(0);
  });
});
