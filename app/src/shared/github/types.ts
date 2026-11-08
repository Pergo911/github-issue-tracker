import type { components } from "@octokit/openapi-types";
import type { Endpoints } from "@octokit/types";

/**
 * GitHub's payload shapes for what this system reads and writes, taken from `@octokit/types` as type-only
 * imports (SPEC 2.6): the Worker's Bot client, the SPA's `githubFetch` and the fake GitHub (ticket #22) all
 * share them, so a field one side relies on cannot silently differ from what another produces. There is no
 * Octokit runtime. Each type keeps only the fields the design uses, with the loose `id: number | bigint` and
 * `labels: (string | {...})[]` unions narrowed to what GitHub actually sends.
 */
type Schemas = components["schemas"];
type Data<Route extends keyof Endpoints> = Endpoints[Route]["response"]["data"];

export type GitHubUser = Pick<
  Schemas["simple-user"],
  "login" | "node_id" | "avatar_url" | "html_url" | "type" | "site_admin"
> & { id: number };

export type GitHubLabel = Pick<Schemas["label"], "node_id" | "name" | "description" | "default"> & {
  id: number;
  /** Six hex digits, no leading `#`. */
  color: string;
};

type IssueFields =
  | "node_id"
  | "number"
  | "title"
  | "body"
  | "state"
  | "state_reason"
  | "locked"
  | "comments"
  | "created_at"
  | "updated_at"
  | "closed_at"
  | "url"
  | "html_url"
  | "comments_url"
  | "events_url"
  | "labels_url"
  | "repository_url"
  | "timeline_url"
  | "author_association"
  | "performed_via_github_app"
  | "pull_request";

type RawIssue = Data<"GET /repos/{owner}/{repo}/issues/{issue_number}">;

export type GitHubIssue = Pick<RawIssue, IssueFields> & {
  /** The database id: `duplicate_issue_id` takes this, not the number. */
  id: number;
  user: GitHubUser;
  labels: GitHubLabel[];
  /** The legacy singular field: present in API version 2022-11-28, removed in 2026-03-10. Read `assignees`. */
  assignee: GitHubUser | null;
  assignees: GitHubUser[];
  closed_by: GitHubUser | null;
};

type RawComment = Data<"GET /repos/{owner}/{repo}/issues/comments/{comment_id}">;

export type GitHubComment = Pick<
  RawComment,
  | "node_id"
  | "url"
  | "html_url"
  | "issue_url"
  | "body"
  | "created_at"
  | "updated_at"
  | "author_association"
  | "performed_via_github_app"
> & { id: number; user: GitHubUser };

interface TimelineEventBase {
  id: number;
  node_id: string;
  url: string;
  actor: GitHubUser;
  created_at: string;
  performed_via_github_app: null;
}

/** The timeline events GitHub generates from the writes the design makes (SPEC 4.3); others are ignored. */
export type GitHubTimelineEvent =
  | (TimelineEventBase & {
      event: "labeled" | "unlabeled";
      commit_id: null;
      commit_url: null;
      label: Pick<GitHubLabel, "name" | "color">;
    })
  | (TimelineEventBase & {
      event: "closed" | "reopened";
      commit_id: null;
      commit_url: null;
      state_reason: "completed" | "not_planned" | "duplicate" | "reopened" | null;
    })
  | (TimelineEventBase & {
      event: "assigned" | "unassigned";
      commit_id: null;
      commit_url: null;
      assignee: GitHubUser;
    })
  | (TimelineEventBase & {
      event: "renamed";
      commit_id: null;
      commit_url: null;
      rename: { from: string; to: string };
    })
  | (Omit<GitHubComment, "performed_via_github_app"> & {
      event: "commented";
      actor: GitHubUser;
      performed_via_github_app: null;
    });

type RawRepo = Data<"GET /repos/{owner}/{repo}">;

/** `permissions` is what the role check reads (SPEC 2.4). `triage` and `maintain` are optional on GitHub. */
export type GitHubRepoPermissions = NonNullable<RawRepo["permissions"]>;

export type GitHubRepository = Pick<
  RawRepo,
  "node_id" | "name" | "full_name" | "private" | "html_url" | "url" | "default_branch"
> & {
  id: number;
  owner: GitHubUser;
  permissions?: GitHubRepoPermissions;
};

export interface GitHubSearchResult {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubIssue[];
}

export interface GitHubInstallationToken {
  token: string;
  /** ISO 8601. The installation token lives one hour. */
  expires_at: string;
  permissions: Record<string, string>;
  repository_selection: "all" | "selected";
}

/** The error body of every GitHub REST failure. */
export interface GitHubErrorBody {
  message: string;
  documentation_url?: string;
  status?: string;
  errors?: { resource?: string; field?: string; code: string; message?: string }[];
}

/** A webhook `issues` delivery's payload, as far as the design reads it (SPEC 3.2, 4.2). */
export interface GitHubIssuesWebhookPayload {
  action:
    | "opened"
    | "edited"
    | "closed"
    | "reopened"
    | "labeled"
    | "unlabeled"
    | "assigned"
    | "unassigned"
    | "deleted";
  issue: GitHubIssue;
  changes?: { title?: { from: string }; body?: { from: string } };
  label?: GitHubLabel;
  assignee?: GitHubUser;
  sender: GitHubUser;
  repository: GitHubRepository;
  installation?: { id: number };
}

/** The device-flow answers (SPEC 2.2). GitHub sends errors as an HTTP 200 JSON body with `error`. */
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  token_type: "bearer";
  scope: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}

export interface DeviceFlowError {
  error: string;
  error_description?: string;
  error_uri?: string;
  interval?: number;
}
