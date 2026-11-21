import { isoSeconds } from "../http.ts";
import type {
  GitHubCollaborator,
  GitHubCollaboratorPermission,
  GitHubComment,
  GitHubIssue,
  GitHubLabel,
  GitHubRepoPermissions,
  GitHubRepository,
  GitHubRepositoryInvitation,
  GitHubTimelineEvent,
  GitHubUser,
} from "../../src/shared/github/types.ts";
import {
  roleRank,
  type Account,
  type CommentRecord,
  type GitHubStore,
  type InvitationRecord,
  type IssueRecord,
  type LabelRecord,
  type RepoRole,
  type StaffRecord,
  type TimelineRecord,
} from "./store.ts";

/** The real hosts: webhook payloads come from github.com whatever base URL the fake is served on. */
export const REAL_API = "https://api.github.com";
export const REAL_WEB = "https://github.com";

export function permissionsFor(role: RepoRole): GitHubRepoPermissions {
  const rank = roleRank(role);
  return {
    admin: role === "admin",
    maintain: rank >= roleRank("maintain"),
    push: rank >= roleRank("write"),
    triage: rank >= roleRank("triage"),
    pull: rank >= roleRank("read"),
  };
}

/** Renders the store's records into GitHub's wire shapes, with URLs under `apiBase`. */
export class Renderer {
  readonly #store: GitHubStore;
  readonly #apiBase: string;

  constructor(store: GitHubStore, apiBase: string) {
    this.#store = store;
    this.#apiBase = apiBase;
  }

  get #repoPath(): string {
    return `${this.#store.options.org}/${this.#store.options.repo}`;
  }

  user(account: Account): GitHubUser {
    return {
      id: account.id,
      login: account.login,
      node_id: `${account.type === "Bot" ? "BOT" : "U"}_fake_${account.id}`,
      avatar_url: `${REAL_WEB}/identicons/${account.id}.png`,
      html_url: `${REAL_WEB}/${account.login}`,
      type: account.type,
      site_admin: false,
    };
  }

  #userByLogin(login: string): GitHubUser {
    const account = this.#store.accountByLogin(login);
    // A deleted account renders as GitHub's `ghost` user.
    return this.user(account ?? { id: 10137, login: "ghost", type: "User" });
  }

  label(record: LabelRecord): GitHubLabel {
    return {
      id: record.id,
      node_id: `LA_fake_${record.id}`,
      name: record.name,
      description: record.description,
      color: record.color,
      default: record.default,
    };
  }

  issue(record: IssueRecord): GitHubIssue {
    const base = `${this.#apiBase}/repos/${this.#repoPath}`;
    const assignees = record.assignees.map((login) => this.#userByLogin(login));
    const authorRole = this.#store.actorForLogin(record.author)?.role ?? "none";
    return {
      id: record.id,
      node_id: `I_fake_${record.id}`,
      number: record.number,
      title: record.title,
      body: record.body,
      state: record.state,
      state_reason: record.stateReason,
      locked: false,
      comments: this.#store.commentsOn(record.number).length,
      created_at: isoSeconds(record.createdAt),
      updated_at: isoSeconds(record.updatedAt),
      closed_at: record.closedAt === null ? null : isoSeconds(record.closedAt),
      url: `${base}/issues/${record.number}`,
      html_url: `${REAL_WEB}/${this.#repoPath}/${record.isPullRequest ? "pull" : "issues"}/${record.number}`,
      comments_url: `${base}/issues/${record.number}/comments`,
      events_url: `${base}/issues/${record.number}/events`,
      labels_url: `${base}/issues/${record.number}/labels{/name}`,
      repository_url: base,
      timeline_url: `${base}/issues/${record.number}/timeline`,
      author_association: authorRole === "none" ? "NONE" : "MEMBER",
      performed_via_github_app: null,
      user: this.#userByLogin(record.author),
      // GitHub lists an issue's labels sorted by name, whatever order they were added in.
      labels: [...record.labels]
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .flatMap((name) => {
          const label = this.#store.label(name);
          return label ? [this.label(label)] : [];
        }),
      assignee: assignees[0] ?? null,
      assignees,
      closed_by: record.closedBy === null ? null : this.#userByLogin(record.closedBy),
      ...(record.isPullRequest
        ? {
            pull_request: {
              url: `${base}/pulls/${record.number}`,
              html_url: `${REAL_WEB}/${this.#repoPath}/pull/${record.number}`,
              diff_url: null,
              patch_url: null,
            },
          }
        : {}),
    };
  }

  comment(record: CommentRecord): GitHubComment {
    const base = `${this.#apiBase}/repos/${this.#repoPath}`;
    return {
      id: record.id,
      node_id: `IC_fake_${record.id}`,
      url: `${base}/issues/comments/${record.id}`,
      html_url: `${REAL_WEB}/${this.#repoPath}/issues/${record.issueNumber}#issuecomment-${record.id}`,
      issue_url: `${base}/issues/${record.issueNumber}`,
      body: record.body,
      user: this.#userByLogin(record.author),
      created_at: isoSeconds(record.createdAt),
      updated_at: isoSeconds(record.updatedAt),
      author_association:
        (this.#store.actorForLogin(record.author)?.role ?? "none") === "none" ? "NONE" : "MEMBER",
      performed_via_github_app: record.author === this.#store.botAccount.login ? this.app() : null,
    };
  }

  /** The Bot's App as GitHub names it on the comments the Bot posts (and not on the issues). */
  app() {
    const { org, bot } = this.#store.options;
    return {
      id: bot.appId,
      slug: bot.slug,
      node_id: `A_fake_${bot.appId}`,
      owner: this.user(this.#store.orgAccount),
      name: bot.slug,
      description: "",
      external_url: `${REAL_WEB}/organizations/${org}`,
      html_url: `${REAL_WEB}/apps/${bot.slug}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      permissions: { issues: "write", metadata: "read" },
      events: [],
    } as unknown as NonNullable<GitHubComment["performed_via_github_app"]>;
  }

  timelineEvent(record: TimelineRecord): GitHubTimelineEvent | null {
    const base = {
      id: record.id,
      node_id: `TE_fake_${record.id}`,
      url: `${this.#apiBase}/repos/${this.#repoPath}/issues/events/${record.id}`,
      actor: this.#userByLogin(record.actor),
      created_at: isoSeconds(record.createdAt),
      performed_via_github_app: null,
    } as const;
    switch (record.event) {
      case "labeled":
      case "unlabeled":
        return {
          ...base,
          event: record.event,
          commit_id: null,
          commit_url: null,
          label: record.label,
        };
      case "closed":
      case "reopened":
        return {
          ...base,
          event: record.event,
          commit_id: null,
          commit_url: null,
          state_reason: record.stateReason,
        };
      case "assigned":
      case "unassigned":
        return {
          ...base,
          event: record.event,
          commit_id: null,
          commit_url: null,
          assignee: this.#userByLogin(record.assignee),
        };
      case "marked_as_duplicate":
        return { ...base, event: "marked_as_duplicate", commit_id: null, commit_url: null };
      case "renamed":
        return {
          ...base,
          event: "renamed",
          commit_id: null,
          commit_url: null,
          rename: record.rename,
        };
      case "commented": {
        const comment = this.#store.comments.get(record.commentId);
        if (!comment) return null;
        // GitHub's `commented` timeline items carry the full comment, and no `id` of the event itself.
        return {
          ...this.comment(comment),
          event: "commented",
          actor: this.#userByLogin(comment.author),
        };
      }
    }
  }

  repository(role: RepoRole | null): GitHubRepository {
    const { org, repo } = this.#store.options;
    return {
      id: 800_001,
      node_id: "R_fake_800001",
      name: repo,
      full_name: `${org}/${repo}`,
      private: true,
      html_url: `${REAL_WEB}/${org}/${repo}`,
      url: `${this.#apiBase}/repos/${org}/${repo}`,
      default_branch: "main",
      owner: this.user(this.#store.orgAccount),
      ...(role === null ? {} : { permissions: permissionsFor(role) }),
    };
  }

  collaborator(member: StaffRecord): GitHubCollaborator {
    return {
      ...this.user(member.account),
      permissions: permissionsFor(member.role),
      role_name: member.role,
    };
  }

  collaboratorPermission(member: StaffRecord): GitHubCollaboratorPermission {
    // GitHub's legacy `permission` field maps `maintain` -> `write` and `triage` -> `read`.
    const legacy =
      member.role === "admin"
        ? "admin"
        : member.role === "maintain" || member.role === "write"
          ? "write"
          : member.role === "triage" || member.role === "read"
            ? "read"
            : "none";
    return {
      permission: legacy,
      role_name: member.role,
      user: this.collaborator(member),
    };
  }

  invitation(record: InvitationRecord): GitHubRepositoryInvitation {
    return {
      id: record.id,
      node_id: `RI_fake_${record.id}`,
      invitee: this.#userByLogin(record.invitee),
      inviter: this.#userByLogin(record.inviter),
      permissions: record.permissions,
      created_at: isoSeconds(record.createdAt),
      expired: record.expired,
      url: `${this.#apiBase}/repos/${this.#repoPath}/invitations/${record.id}`,
      html_url: `${REAL_WEB}/${this.#repoPath}/invitations`,
    };
  }
}
