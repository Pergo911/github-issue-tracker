import { queryOptions } from "@tanstack/react-query";
import type { GitHubIssue, GitHubTimelineEvent, GitHubUser } from "@shared/github/types.ts";
import { staffSession } from "../auth/session.ts";
import { GitHubHttpError } from "../github/session.ts";

interface Repo {
  owner: string;
  name: string;
}

/** The repo's issues are Reports; pull requests come back from the same endpoints and are not. */
const reportsOnly = (issues: GitHubIssue[]) => issues.filter((issue) => !issue.pull_request);

/**
 * Every Report, open and closed, every page (SPEC 2.4): filtering and sorting happen client-side over this.
 * Refetched on every navigation to the List (`refetchOnMount: "always"`) and by the manual refresh control.
 */
export const reportsQuery = (repo: Repo) =>
  queryOptions({
    queryKey: ["staff", "reports", "all", repo.owner, repo.name],
    queryFn: async () =>
      reportsOnly(
        await staffSession.githubFetchAll<GitHubIssue>(
          `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues`,
          { state: "all", sort: "created", direction: "asc" },
        ),
      ),
    refetchOnMount: "always",
    retry: false,
  });

const repoPath = (repo: Repo) =>
  `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

/** One Report and its whole timeline (every page), read fresh each time the Detail view opens. */
export const reportDetailQuery = (repo: Repo, number: number) =>
  queryOptions({
    queryKey: ["staff", "report", repo.owner, repo.name, number],
    queryFn: async () => {
      const path = `${repoPath(repo)}/issues/${number}`;
      const [issue, timeline] = await Promise.all([
        staffSession.githubJson<GitHubIssue>(path),
        staffSession.githubFetchAll<GitHubTimelineEvent>(`${path}/timeline`),
      ]);
      // The issues endpoints also answer for pull requests; a Report is never one.
      if (issue.pull_request) throw new GitHubHttpError(404, "Not Found");
      return { issue, timeline };
    },
    refetchOnMount: "always",
    retry: false,
  });

/** The members an issue can be assigned to (the assignee picker's options). */
export const assignableQuery = (repo: Repo) =>
  queryOptions({
    queryKey: ["staff", "assignable", repo.owner, repo.name],
    queryFn: () => staffSession.githubFetchAll<GitHubUser>(`${repoPath(repo)}/assignees`),
    staleTime: 60_000,
    retry: false,
  });

/** Free-text lookup across the whole history through GitHub's search API (read access suffices). */
export const reportSearchQuery = (repo: Repo, text: string) =>
  queryOptions({
    queryKey: ["staff", "reports", "search", repo.owner, repo.name, text],
    queryFn: async () =>
      reportsOnly(
        await staffSession.githubFetchAll<GitHubIssue>(
          "/search/issues",
          { q: `${text} repo:${repo.owner}/${repo.name} is:issue`, sort: "created", order: "asc" },
          (body) => (body as { items: GitHubIssue[] }).items,
          // The search API returns at most 1000 results (10 pages of 100).
          10,
        ),
      ),
    refetchOnMount: "always",
    retry: false,
  });
