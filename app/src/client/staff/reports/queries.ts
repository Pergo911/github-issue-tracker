import { queryOptions } from "@tanstack/react-query";
import type { GitHubIssue } from "@shared/github/types.ts";
import { staffSession } from "../auth/session.ts";

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
