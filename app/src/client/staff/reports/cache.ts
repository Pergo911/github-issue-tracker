import type { QueryClient } from "@tanstack/react-query";
import type { Dimension } from "@shared/config/schema.ts";
import type {
  GitHubIssue,
  GitHubLabel,
  GitHubTimelineEvent,
  GitHubUser,
} from "@shared/github/types.ts";
import { setDimension } from "@shared/reports/labels.ts";
import { reportDetailQuery, reportsQuery } from "./queries.ts";

interface Repo {
  owner: string;
  name: string;
}

/** Replaces the labels of one `dimension` on a cached issue, preserving metadata for unchanged labels. */
export function setDimensionOptimistically(
  issue: GitHubIssue,
  dimension: Dimension,
  id: string,
): GitHubIssue {
  const names = setDimension(
    issue.labels.map((label) => label.name),
    dimension,
    id,
  );
  const known = new Map(issue.labels.map((label) => [label.name, label]));
  return {
    ...issue,
    labels: names.map((name) => known.get(name) ?? ({ name } as GitHubLabel)),
  };
}

/** Replaces the single assignee on a cached issue, matching against known assignable users when available. */
export function setAssigneeOptimistically(
  issue: GitHubIssue,
  login: string | null,
  assignable?: readonly GitHubUser[],
): GitHubIssue {
  if (login === null) return { ...issue, assignee: null, assignees: [] };
  const user =
    assignable?.find((candidate) => candidate.login === login) ??
    issue.assignees.find((candidate) => candidate.login === login) ??
    ({ login } as GitHubUser);
  return {
    ...issue,
    assignee: user,
    assignees: [user],
  };
}

/**
 * Patches an authoritative `GitHubIssue` returned by a mutation into all matching Staff report caches:
 * the full List/Board query, any active search queries, and the cached Detail query (preserving timeline).
 */
export function patchIssueInCaches(
  queryClient: QueryClient,
  repo: Repo,
  updated: GitHubIssue,
): void {
  const replace = (issues: GitHubIssue[] | undefined) =>
    issues?.map((issue) => (issue.number === updated.number ? updated : issue));

  queryClient.setQueryData<GitHubIssue[]>(reportsQuery(repo).queryKey, replace);
  queryClient.setQueriesData<GitHubIssue[]>(
    { queryKey: ["staff", "reports", "search", repo.owner, repo.name] },
    replace,
  );
  queryClient.setQueryData<{ issue: GitHubIssue; timeline: GitHubTimelineEvent[] }>(
    reportDetailQuery(repo, updated.number).queryKey,
    (current) => (current ? { ...current, issue: updated } : current),
  );
}
