import type { GitHubInvitationPermission } from "../../src/shared/github/types.ts";
import type { Clock } from "../clock.ts";

/** GitHub's five repo roles, plus `none` for a signed-in user who is not a member (a private repo: 404). */
export type RepoRole = "none" | "read" | "triage" | "write" | "maintain" | "admin";
export const REPO_ROLES: readonly RepoRole[] = [
  "none",
  "read",
  "triage",
  "write",
  "maintain",
  "admin",
];

export function roleRank(role: RepoRole): number {
  return REPO_ROLES.indexOf(role);
}

export function maxRepoRole(a: RepoRole, b: RepoRole): RepoRole {
  return roleRank(a) >= roleRank(b) ? a : b;
}

export interface Account {
  id: number;
  login: string;
  type: "User" | "Bot" | "Organization";
}

export interface StaffRecord {
  account: Account;
  /** Effective role (higher of `directRole` and `inheritedRole`). */
  role: RepoRole;
  directRole: RepoRole;
  inheritedRole: RepoRole;
  orgMember: boolean;
  /** Whether this user's Staff tokens carry Repository `Administration: read & write` (ADR 0006). */
  hasAdminPermission: boolean;
}

export interface InvitationRecord {
  id: number;
  invitee: string;
  inviter: string;
  permissions: GitHubInvitationPermission;
  createdAt: number;
  expired: boolean;
}

/** Who is making a call: an account and the repo role it has (the Bot's installation token acts as `write`). */
export interface Actor {
  account: Account;
  role: RepoRole;
}

export interface LabelRecord {
  id: number;
  name: string;
  color: string;
  description: string | null;
  default: boolean;
}

export type StateReason = "completed" | "not_planned" | "duplicate" | "reopened";

export interface IssueRecord {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  stateReason: StateReason | null;
  /** Label names, in the order they were added. */
  labels: string[];
  /** Assignee logins. */
  assignees: string[];
  author: string;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  closedBy: string | null;
  /** Pull requests come back from the issues endpoints with a `pull_request` key; the fake can seed some. */
  isPullRequest: boolean;
}

export interface CommentRecord {
  id: number;
  issueNumber: number;
  author: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export type TimelineDetail =
  | { event: "labeled" | "unlabeled"; label: { name: string; color: string } }
  | { event: "closed" | "reopened"; stateReason: StateReason | null }
  | { event: "marked_as_duplicate" }
  | { event: "assigned" | "unassigned"; assignee: string }
  | { event: "renamed"; rename: { from: string; to: string } }
  | { event: "commented"; commentId: number };

export type TimelineRecord = {
  id: number;
  issueNumber: number;
  actor: string;
  createdAt: number;
} & TimelineDetail;

/** What a write changed, for the `issues` webhook (one delivery per event). */
export interface IssueEvent {
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
  issueNumber: number;
  sender: Account;
  label?: LabelRecord;
  assignee?: Account;
  changes?: { title?: { from: string }; body?: { from: string } };
}

/** A failure the HTTP layer turns into GitHub's error body. */
export class GitHubFailure extends Error {
  readonly status: number;
  readonly errors:
    { resource?: string; field?: string; code: string; message?: string }[] | undefined;
  constructor(
    status: number,
    message: string,
    errors?: { resource?: string; field?: string; code: string; message?: string }[],
  ) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

/**
 * Behaviour the live GitHub leaves unconfirmed. Ticket #32 decides each against a real sandbox repo; until
 * then the defaults follow GitHub's documentation, and a test can flip them to prove the code copes.
 */
export interface StoreSettings {
  /** An unknown label in a create or PATCH: GitHub's docs say push users create it; `ignore` drops it. */
  unknownLabels: "create" | "ignore";
  /**
   * Whether a Triage user's label changes in an issue PATCH take effect. GitHub's PATCH documentation says
   * only push access can set labels (silently dropped otherwise); the design assumes Triage can.
   */
  triageCanLabel: boolean;
  /** Whether the Staff GitHub App currently has approved Repository `Administration: read & write` (ADR 0006). */
  staffAppAdministration: boolean;
}

export const DEFAULT_SETTINGS: StoreSettings = {
  unknownLabels: "create",
  triageCanLabel: true,
  staffAppAdministration: true,
};

export interface StoreOptions {
  org: string;
  repo: string;
  bot: { slug: string; accountId: number; appId: number };
}

const DEFAULT_LABEL_COLOR = "ededed";
const FIRST_ISSUE_ID = 3_141_592_000;

export class GitHubStore {
  readonly options: StoreOptions;
  readonly clock: Clock;
  settings: StoreSettings = { ...DEFAULT_SETTINGS };

  readonly orgAccount: Account;
  readonly botAccount: Account;
  readonly staff = new Map<string, StaffRecord>();
  readonly invitations = new Map<number, InvitationRecord>();
  readonly labels = new Map<string, LabelRecord>();
  readonly issues = new Map<number, IssueRecord>();
  readonly comments = new Map<number, CommentRecord>();
  readonly timeline: TimelineRecord[] = [];
  /** Database ids of issues that were deleted (GET answers 410 for these numbers). */
  readonly deletedNumbers = new Set<number>();

  #nextIssueNumber = 1;
  #nextIssueId = FIRST_ISSUE_ID;
  #nextCommentId = 1_000_000_001;
  #nextLabelId = 2_000_000_001;
  #nextInvitationId = 5_000_000_001;
  #nextEventId = 9_000_000_001;
  #nextUserId = 1_000_001;

  constructor(options: StoreOptions, clock: Clock) {
    this.options = options;
    this.clock = clock;
    this.orgAccount = { id: 900_001, login: options.org, type: "Organization" };
    this.botAccount = { id: options.bot.accountId, login: `${options.bot.slug}[bot]`, type: "Bot" };
  }

  reset(): void {
    this.staff.clear();
    this.invitations.clear();
    this.labels.clear();
    this.issues.clear();
    this.comments.clear();
    this.timeline.length = 0;
    this.deletedNumbers.clear();
    this.settings = { ...DEFAULT_SETTINGS };
    this.#nextIssueNumber = 1;
    this.#nextIssueId = FIRST_ISSUE_ID;
    this.#nextCommentId = 1_000_000_001;
    this.#nextLabelId = 2_000_000_001;
    this.#nextInvitationId = 5_000_000_001;
    this.#nextEventId = 9_000_000_001;
    this.#nextUserId = 1_000_001;
  }

  // ---------------------------------------------------------------------------------------- accounts

  addStaff(
    login: string,
    role: RepoRole,
    options: {
      inheritedRole?: RepoRole;
      orgMember?: boolean;
      hasAdminPermission?: boolean;
    } = {},
  ): Account {
    const key = login.toLowerCase();
    const inheritedRole = options.inheritedRole ?? "none";
    const effective = maxRepoRole(role, inheritedRole);
    const orgMember = options.orgMember ?? effective !== "none";
    const hasAdminPermission = options.hasAdminPermission ?? true;
    const existing = this.staff.get(key);
    if (existing) {
      existing.directRole = role;
      existing.inheritedRole = inheritedRole;
      existing.role = effective;
      existing.orgMember = orgMember;
      existing.hasAdminPermission = hasAdminPermission;
      return existing.account;
    }
    const account: Account = { id: this.#nextUserId++, login, type: "User" };
    this.staff.set(key, {
      account,
      role: effective,
      directRole: role,
      inheritedRole,
      orgMember,
      hasAdminPermission,
    });
    return account;
  }

  staffByLogin(login: string): StaffRecord | undefined {
    return this.staff.get(login.toLowerCase());
  }

  accountByLogin(login: string): Account | undefined {
    if (login.toLowerCase() === this.botAccount.login.toLowerCase()) return this.botAccount;
    if (login.toLowerCase() === this.orgAccount.login.toLowerCase()) return this.orgAccount;
    return this.staffByLogin(login)?.account;
  }

  actorForLogin(login: string): Actor | undefined {
    if (login.toLowerCase() === this.botAccount.login.toLowerCase()) {
      return { account: this.botAccount, role: "write" };
    }
    const member = this.staffByLogin(login);
    return member ? { account: member.account, role: member.role } : undefined;
  }

  // ----------------------------------------------------------------------- collaborators & invites

  collaborators(affiliation: "all" | "direct" | "outside"): StaffRecord[] {
    return [...this.staff.values()].filter((member) => {
      if (affiliation === "all" && member.role === "none") return false;
      if (affiliation === "direct" && member.directRole === "none") return false;
      if (affiliation === "outside" && (member.directRole === "none" || member.orgMember)) {
        return false;
      }
      return true;
    });
  }

  addOrUpdateCollaborator(
    inviter: Account,
    username: string,
    permission: Exclude<RepoRole, "none">,
  ): { status: 204 } | { status: 201; invitation: InvitationRecord } {
    const member = this.staffByLogin(username);
    if (!member) throw new GitHubFailure(404, "Not Found");
    if (member.orgMember || member.role !== "none") {
      member.directRole = permission;
      member.role = maxRepoRole(member.directRole, member.inheritedRole);
      return { status: 204 };
    }
    const existing = [...this.invitations.values()].find(
      (inv) => inv.invitee.toLowerCase() === member.account.login.toLowerCase(),
    );
    if (existing) {
      existing.permissions = permission;
      return { status: 201, invitation: existing };
    }
    const invitation: InvitationRecord = {
      id: this.#nextInvitationId++,
      invitee: member.account.login,
      inviter: inviter.login,
      permissions: permission,
      createdAt: this.clock.now(),
      expired: false,
    };
    this.invitations.set(invitation.id, invitation);
    return { status: 201, invitation };
  }

  removeCollaborator(actor: Account, username: string): void {
    const member = this.staffByLogin(username);
    if (!member) throw new GitHubFailure(404, "Not Found");
    member.directRole = "none";
    member.role = maxRepoRole(member.directRole, member.inheritedRole);
    if (member.role === "none") {
      // GitHub automatically unassigns open issues when a collaborator loses repository access.
      const login = member.account.login;
      for (const issue of this.issues.values()) {
        if (issue.state !== "open" || !issue.assignees.includes(login)) continue;
        issue.assignees = issue.assignees.filter((current) => current !== login);
        issue.updatedAt = this.clock.now();
        this.#record(issue.number, actor, { event: "unassigned", assignee: login });
      }
    }
  }

  collaboratorPermission(username: string): StaffRecord {
    const member = this.staffByLogin(username);
    if (!member) throw new GitHubFailure(404, "Not Found");
    return member;
  }

  listInvitations(): InvitationRecord[] {
    return [...this.invitations.values()];
  }

  updateInvitation(id: number, permissions: GitHubInvitationPermission): InvitationRecord {
    const invitation = this.invitations.get(id);
    if (!invitation) throw new GitHubFailure(404, "Not Found");
    invitation.permissions = permissions;
    return invitation;
  }

  deleteInvitation(id: number): void {
    if (!this.invitations.has(id)) throw new GitHubFailure(404, "Not Found");
    this.invitations.delete(id);
  }

  // ------------------------------------------------------------------------------------------ labels

  label(name: string): LabelRecord | undefined {
    return this.labels.get(name.toLowerCase());
  }

  createLabel(name: string, color?: string, description?: string | null): LabelRecord {
    if (this.label(name)) {
      throw new GitHubFailure(422, "Validation Failed", [
        { resource: "Label", code: "already_exists", field: "name" },
      ]);
    }
    return this.#insertLabel(name, color, description);
  }

  #insertLabel(name: string, color?: string, description?: string | null): LabelRecord {
    const record: LabelRecord = {
      id: this.#nextLabelId++,
      name,
      color: normaliseColor(color) ?? DEFAULT_LABEL_COLOR,
      description: description ?? null,
      default: false,
    };
    this.labels.set(name.toLowerCase(), record);
    return record;
  }

  /** Removes the label from the repo and from every issue that carries it. */
  deleteLabel(name: string): void {
    if (!this.label(name)) throw new GitHubFailure(404, "Not Found");
    this.labels.delete(name.toLowerCase());
    for (const issue of this.issues.values()) {
      issue.labels = issue.labels.filter((current) => current.toLowerCase() !== name.toLowerCase());
    }
  }

  updateLabel(
    name: string,
    patch: { new_name?: string; color?: string; description?: string | null },
  ): LabelRecord {
    const record = this.label(name);
    if (!record) throw new GitHubFailure(404, "Not Found");
    if (patch.color !== undefined && normaliseColor(patch.color) === null) {
      throw new GitHubFailure(422, "Validation Failed", [
        { resource: "Label", code: "invalid", field: "color" },
      ]);
    }
    if (patch.new_name !== undefined && patch.new_name.toLowerCase() !== name.toLowerCase()) {
      if (this.label(patch.new_name)) {
        throw new GitHubFailure(422, "Validation Failed", [
          { resource: "Label", code: "already_exists", field: "name" },
        ]);
      }
      this.labels.delete(name.toLowerCase());
      for (const issue of this.issues.values()) {
        issue.labels = issue.labels.map((current) =>
          current.toLowerCase() === name.toLowerCase() ? (patch.new_name as string) : current,
        );
      }
      record.name = patch.new_name;
      this.labels.set(record.name.toLowerCase(), record);
    } else if (patch.new_name !== undefined) {
      record.name = patch.new_name;
    }
    const color = normaliseColor(patch.color);
    if (color !== null) record.color = color;
    if (patch.description !== undefined) record.description = patch.description;
    return record;
  }

  // ----------------------------------------------------------------------------------------- issues

  issue(number: number): IssueRecord {
    if (this.deletedNumbers.has(number)) throw new GitHubFailure(410, "This issue was deleted");
    const record = this.issues.get(number);
    if (!record) throw new GitHubFailure(404, "Not Found");
    return record;
  }

  issueByDatabaseId(id: number): IssueRecord | undefined {
    for (const record of this.issues.values()) if (record.id === id) return record;
    return undefined;
  }

  /** Resolves requested label names to the labels they become, per `settings.unknownLabels`. */
  #resolveLabels(requested: string[]): LabelRecord[] {
    const resolved: LabelRecord[] = [];
    for (const name of requested) {
      let record = this.label(name);
      if (!record && this.settings.unknownLabels === "create") record = this.#insertLabel(name);
      if (record && !resolved.includes(record)) resolved.push(record);
    }
    return resolved;
  }

  #canSetLabels(actor: Actor): boolean {
    const rank = roleRank(actor.role);
    if (rank >= roleRank("write")) return true;
    return rank >= roleRank("triage") && this.settings.triageCanLabel;
  }

  /** Assignable users are members with any role; GitHub silently drops the rest. */
  #resolveAssignees(requested: string[]): Account[] {
    const resolved: Account[] = [];
    for (const login of requested) {
      const member = this.staffByLogin(login);
      const account = member && member.role !== "none" ? member.account : undefined;
      if (account && !resolved.includes(account)) resolved.push(account);
    }
    return resolved.slice(0, 10);
  }

  #record(issueNumber: number, actor: Account, detail: TimelineDetail) {
    this.timeline.push({
      id: this.#nextEventId++,
      issueNumber,
      actor: actor.login,
      createdAt: this.clock.now(),
      ...detail,
    });
  }

  createIssue(
    actor: Actor,
    input: {
      title: string;
      body?: string | null;
      labels?: string[];
      assignees?: string[];
      isPullRequest?: boolean;
    },
  ): { issue: IssueRecord; events: IssueEvent[] } {
    const now = this.clock.now();
    const issue: IssueRecord = {
      id: this.#nextIssueId++,
      number: this.#nextIssueNumber++,
      title: input.title,
      body: input.body ?? null,
      state: "open",
      stateReason: null,
      labels: [],
      assignees: [],
      author: actor.account.login,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      closedBy: null,
      isPullRequest: input.isPullRequest ?? false,
    };
    this.issues.set(issue.number, issue);
    const events: IssueEvent[] = [
      { action: "opened", issueNumber: issue.number, sender: actor.account },
    ];

    // Only triage and above can set labels and assignees on create; for others GitHub drops them silently.
    if (roleRank(actor.role) >= roleRank("triage")) {
      for (const label of this.#resolveLabels(input.labels ?? [])) {
        issue.labels.push(label.name);
        this.#record(issue.number, actor.account, {
          event: "labeled",
          label: { name: label.name, color: label.color },
        });
        events.push({ action: "labeled", issueNumber: issue.number, sender: actor.account, label });
      }
      for (const assignee of this.#resolveAssignees(input.assignees ?? [])) {
        issue.assignees.push(assignee.login);
        this.#record(issue.number, actor.account, { event: "assigned", assignee: assignee.login });
        events.push({
          action: "assigned",
          issueNumber: issue.number,
          sender: actor.account,
          assignee,
        });
      }
    }
    return { issue, events };
  }

  updateIssue(
    actor: Actor,
    number: number,
    patch: {
      title?: string;
      body?: string | null;
      state?: "open" | "closed";
      state_reason?: StateReason | null;
      duplicate_issue_id?: number;
      labels?: string[];
      assignees?: string[];
    },
  ): { issue: IssueRecord; events: IssueEvent[] } {
    const issue = this.issue(number);
    const events: IssueEvent[] = [];
    const sender = actor.account;
    const stateWillChange = patch.state !== undefined && patch.state !== issue.state;

    if (patch.duplicate_issue_id !== undefined) {
      const original = this.issueByDatabaseId(patch.duplicate_issue_id);
      if (!original || original.number === issue.number) {
        throw new GitHubFailure(422, "Validation Failed", [
          { resource: "Issue", code: "invalid", field: "duplicate_issue_id" },
        ]);
      }
    }

    // One `edited` webhook carries every field a single PATCH changed.
    const changes: NonNullable<IssueEvent["changes"]> = {};
    if (patch.title !== undefined && patch.title !== issue.title) {
      this.#record(issue.number, sender, {
        event: "renamed",
        rename: { from: issue.title, to: patch.title },
      });
      changes.title = { from: issue.title };
      issue.title = patch.title;
    }
    if (patch.body !== undefined && patch.body !== issue.body) {
      changes.body = { from: issue.body ?? "" };
      issue.body = patch.body;
    }
    if (changes.title || changes.body) {
      events.push({ action: "edited", issueNumber: issue.number, sender, changes });
    }

    if (patch.labels !== undefined && this.#canSetLabels(actor)) {
      const wanted = this.#resolveLabels(patch.labels);
      const wantedNames = new Set(wanted.map((label) => label.name.toLowerCase()));
      for (const name of [...issue.labels]) {
        if (wantedNames.has(name.toLowerCase())) continue;
        const label = this.label(name);
        issue.labels = issue.labels.filter((current) => current !== name);
        this.#record(issue.number, sender, {
          event: "unlabeled",
          label: { name, color: label?.color ?? DEFAULT_LABEL_COLOR },
        });
        if (label) events.push({ action: "unlabeled", issueNumber: issue.number, sender, label });
      }
      const have = new Set(issue.labels.map((name) => name.toLowerCase()));
      for (const label of wanted) {
        if (have.has(label.name.toLowerCase())) continue;
        issue.labels.push(label.name);
        this.#record(issue.number, sender, {
          event: "labeled",
          label: { name: label.name, color: label.color },
        });
        events.push({ action: "labeled", issueNumber: issue.number, sender, label });
      }
    }

    if (patch.assignees !== undefined && roleRank(actor.role) >= roleRank("triage")) {
      const wanted = this.#resolveAssignees(patch.assignees);
      const wantedLogins = new Set(wanted.map((account) => account.login));
      for (const login of [...issue.assignees]) {
        if (wantedLogins.has(login)) continue;
        const assignee = this.accountByLogin(login);
        issue.assignees = issue.assignees.filter((current) => current !== login);
        this.#record(issue.number, sender, { event: "unassigned", assignee: login });
        if (assignee)
          events.push({ action: "unassigned", issueNumber: issue.number, sender, assignee });
      }
      for (const assignee of wanted) {
        if (issue.assignees.includes(assignee.login)) continue;
        issue.assignees.push(assignee.login);
        this.#record(issue.number, sender, { event: "assigned", assignee: assignee.login });
        events.push({ action: "assigned", issueNumber: issue.number, sender, assignee });
      }
    }

    // `state_reason` is ignored unless the state changes (GitHub's docs).
    if (stateWillChange && patch.state === "closed") {
      const reason: StateReason =
        patch.state_reason === "not_planned" || patch.state_reason === "duplicate"
          ? patch.state_reason
          : "completed";
      issue.state = "closed";
      issue.stateReason = reason;
      issue.closedAt = this.clock.now();
      issue.closedBy = sender.login;
      // GitHub's `closed` event leaves the default reason out: only the issue itself says `completed`.
      this.#record(issue.number, sender, {
        event: "closed",
        stateReason: reason === "completed" ? null : reason,
      });
      if (patch.duplicate_issue_id !== undefined && reason === "duplicate") {
        const original = this.issueByDatabaseId(patch.duplicate_issue_id);
        if (original) this.#record(original.number, sender, { event: "marked_as_duplicate" });
      }
      events.push({ action: "closed", issueNumber: issue.number, sender });
    } else if (stateWillChange && patch.state === "open") {
      issue.state = "open";
      issue.stateReason = "reopened";
      issue.closedAt = null;
      issue.closedBy = null;
      this.#record(issue.number, sender, { event: "reopened", stateReason: "reopened" });
      events.push({ action: "reopened", issueNumber: issue.number, sender });
    }

    if (events.length > 0) issue.updatedAt = this.clock.now();
    return { issue, events };
  }

  /** Deletes an issue the way an admin does in the GitHub UI (Erasure, SPEC 5): it and its comments go. */
  deleteIssue(actor: Account, number: number): IssueEvent {
    const issue = this.issue(number);
    this.issues.delete(number);
    this.deletedNumbers.add(number);
    for (const comment of [...this.comments.values()]) {
      if (comment.issueNumber === number) this.comments.delete(comment.id);
    }
    for (let index = this.timeline.length - 1; index >= 0; index--) {
      if (this.timeline[index]?.issueNumber === number) this.timeline.splice(index, 1);
    }
    return { action: "deleted", issueNumber: issue.number, sender: actor };
  }

  /** The issue as the `deleted` webhook needs it: after deletion the record is gone, so keep a copy first. */
  snapshotIssue(number: number): IssueRecord {
    return structuredClone(this.issue(number));
  }

  // --------------------------------------------------------------------------------------- comments

  comment(id: number): CommentRecord {
    const record = this.comments.get(id);
    if (!record) throw new GitHubFailure(404, "Not Found");
    return record;
  }

  createComment(actor: Account, number: number, body: string): CommentRecord {
    const issue = this.issue(number);
    const now = this.clock.now();
    const record: CommentRecord = {
      id: this.#nextCommentId++,
      issueNumber: number,
      author: actor.login,
      body,
      createdAt: now,
      updatedAt: now,
    };
    this.comments.set(record.id, record);
    this.#record(number, actor, { event: "commented", commentId: record.id });
    issue.updatedAt = now;
    return record;
  }

  updateComment(id: number, body: string): CommentRecord {
    const record = this.comment(id);
    record.body = body;
    record.updatedAt = this.clock.now();
    return record;
  }

  deleteComment(id: number): void {
    const record = this.comment(id);
    this.comments.delete(id);
    const index = this.timeline.findIndex(
      (entry) => entry.event === "commented" && entry.commentId === id,
    );
    if (index !== -1) this.timeline.splice(index, 1);
    const issue = this.issues.get(record.issueNumber);
    if (issue) issue.updatedAt = this.clock.now();
  }

  commentsOn(number: number): CommentRecord[] {
    return [...this.comments.values()].filter((comment) => comment.issueNumber === number);
  }
}

/** `"0075ca"` or `"#0075CA"` to lower-case hex without `#`; `null` when it is not six hex digits. */
export function normaliseColor(color: string | undefined): string | null {
  if (color === undefined) return null;
  const hex = color.replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(hex) ? hex : null;
}
