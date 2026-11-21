import { GITHUB_API_VERSION } from "../../src/shared/github/constants.ts";
import type {
  GitHubErrorBody,
  GitHubInvitationPermission,
  GitHubIssue,
  GitHubIssuesWebhookPayload,
} from "../../src/shared/github/types.ts";
import type { Clock } from "../clock.ts";
import { fromBase64Url, importPublicKey } from "../keys.ts";
import {
  jsonResponse,
  paginate,
  readJson,
  Router,
  isoSeconds,
  type RouteContext,
} from "../http.ts";
import { renderMarkdown, wantsHtml } from "./markdown.ts";
import { permissionsFor, REAL_API, Renderer } from "./render.ts";
import { searchIssues } from "./search.ts";
import {
  GitHubFailure,
  roleRank,
  type Actor,
  type GitHubStore,
  type IssueEvent,
  type IssueRecord,
  type RepoRole,
  type StateReason,
} from "./store.ts";
import type { TokenRegistry } from "./tokens.ts";
import type { WebhookHub } from "./webhooks.ts";

export interface BotApp {
  appId: number;
  clientId: string;
  slug: string;
  installationId: number;
  /** SPKI PEM: what App JWTs are verified with. */
  publicKey: string;
}

export interface GitHubServiceDeps {
  store: GitHubStore;
  tokens: TokenRegistry;
  webhooks: WebhookHub;
  clock: Clock;
  bot: BotApp;
}

const DOCS = "https://docs.github.com/rest";

export function errorBody(
  status: number,
  message: string,
  errors?: GitHubErrorBody["errors"],
): GitHubErrorBody {
  return {
    message,
    ...(errors ? { errors } : {}),
    documentation_url: DOCS,
    status: String(status),
  };
}

function failure(status: number, message: string, errors?: GitHubErrorBody["errors"]): Response {
  return jsonResponse(errorBody(status, message, errors), status);
}

const validation = (field: string, code: string, resource = "Issue") =>
  new GitHubFailure(422, "Validation Failed", [{ resource, field, code }]);

type Json = Record<string, unknown>;

function asObject(body: unknown): Json {
  if (body === undefined) return {};
  if (body === "invalid" || body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new GitHubFailure(400, "Problems parsing JSON");
  }
  return body as Json;
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw validation(field, "invalid");
  return value.map((entry) => {
    if (typeof entry === "string") return entry;
    if (
      field === "labels" &&
      entry &&
      typeof entry === "object" &&
      typeof (entry as Json)["name"] === "string"
    ) {
      return (entry as Json)["name"] as string;
    }
    throw validation(field, "invalid");
  });
}

function optionalString(
  value: unknown,
  field: string,
  allowNull = false,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && allowNull) return null;
  if (typeof value !== "string") throw validation(field, "invalid");
  return value;
}

/** Sorts by a tuple key (compared left to right), so a timestamp tie falls back to the number or id. */
function sortBy<T>(
  items: T[],
  key: (item: T) => [number, number],
  direction: string | null,
  fallback: "asc" | "desc",
): T[] {
  const factor = (direction ?? fallback) === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const [a1, a2] = key(a);
    const [b1, b2] = key(b);
    return (a1 - b1 || a2 - b2) * factor;
  });
}

const STATE_REASONS: readonly (StateReason | null)[] = [
  "completed",
  "not_planned",
  "duplicate",
  "reopened",
  null,
];

const COLLABORATOR_PERMISSIONS: Readonly<Record<string, Exclude<RepoRole, "none">>> = {
  pull: "read",
  triage: "triage",
  push: "write",
  maintain: "maintain",
  admin: "admin",
};

const INVITATION_PERMISSIONS: readonly GitHubInvitationPermission[] = [
  "read",
  "triage",
  "write",
  "maintain",
  "admin",
];

/** The REST API as `api.github.com`: everything the design uses (SPEC 2.2-2.4, 3.2, 3.3, 4.1-4.4). */
export class GitHubService {
  readonly #deps: GitHubServiceDeps;
  readonly #router = new Router();
  #publicKey: Promise<CryptoKey> | null = null;

  constructor(deps: GitHubServiceDeps) {
    this.#deps = deps;
    this.#routes();
  }

  async handle(request: Request, path: string): Promise<Response> {
    const response = await this.#dispatch(request, path);
    return withCors(response);
  }

  async #dispatch(request: Request, path: string): Promise<Response> {
    if (request.method === "OPTIONS") return preflight();
    if (!request.headers.get("user-agent")) {
      return failure(
        403,
        "Request forbidden by administrative rules. Please make sure your request has a User-Agent header.",
      );
    }
    const version = request.headers.get("x-github-api-version");
    if (version !== GITHUB_API_VERSION) {
      return failure(
        400,
        `The fake GitHub requires "X-GitHub-Api-Version: ${GITHUB_API_VERSION}" (the one shared constant); got ${version === null ? "none" : `"${version}"`}.`,
      );
    }
    const matched = this.#router.match(request.method, path);
    if (matched === null) return failure(404, "Not Found");
    if (matched === "method") return failure(404, "Not Found");
    const url = new URL(request.url);
    try {
      return await matched.handler({ request, url, params: matched.params, path });
    } catch (error) {
      if (error instanceof GitHubFailure) return failure(error.status, error.message, error.errors);
      throw error;
    }
  }

  // ------------------------------------------------------------------------------------- helpers

  get #store() {
    return this.#deps.store;
  }

  #renderer(url: URL): Renderer {
    return new Renderer(this.#store, `${url.origin}${apiPrefix(url)}`);
  }

  /** The caller's identity from `Authorization`, or a thrown 401. */
  #authenticate(request: Request): Actor {
    const header = request.headers.get("authorization");
    if (!header) throw new GitHubFailure(401, "Requires authentication");
    const match = /^(?:bearer|token)\s+(\S+)$/i.exec(header);
    if (!match) throw new GitHubFailure(401, "Bad credentials");
    const record = this.#deps.tokens.lookup(match[1] as string);
    if (!record || record === "expired") throw new GitHubFailure(401, "Bad credentials");
    const actor = this.#store.actorForLogin(record.login);
    if (!actor) throw new GitHubFailure(401, "Bad credentials");
    return actor;
  }

  /** Authenticates and requires membership of the repo: a private repo answers 404 to everyone else. */
  #member(context: RouteContext, minimum: RepoRole = "read"): Actor {
    const actor = this.#authenticate(context.request);
    const { owner, repo } = context.params;
    const { org, repo: repoName } = this.#store.options;
    if (
      owner?.toLowerCase() !== org.toLowerCase() ||
      repo?.toLowerCase() !== repoName.toLowerCase()
    ) {
      throw new GitHubFailure(404, "Not Found");
    }
    if (actor.role === "none") throw new GitHubFailure(404, "Not Found");
    if (roleRank(actor.role) < roleRank(minimum)) {
      throw new GitHubFailure(403, "Resource not accessible by integration");
    }
    return actor;
  }

  /**
   * Requires both the repo role AND Repository `Administration` App permission (ADR 0006):
   * the Bot installation token never has Administration, and a stale Staff token or unapproved App returns 403.
   */
  #requireAdministration(context: RouteContext, minimum: RepoRole = "admin"): Actor {
    const actor = this.#member(context, minimum);
    if (actor.account.type === "Bot") {
      throw new GitHubFailure(403, "Resource not accessible by integration");
    }
    if (!this.#store.settings.staffAppAdministration) {
      throw new GitHubFailure(403, "Resource not accessible by integration");
    }
    if (this.#store.staffByLogin(actor.account.login)?.hasAdminPermission === false) {
      throw new GitHubFailure(403, "Resource not accessible by integration");
    }
    return actor;
  }

  #emit(events: IssueEvent[], snapshot?: IssueRecord): void {
    const renderer = new Renderer(this.#store, REAL_API);
    for (const event of events) {
      const record = snapshot ?? this.#store.issue(event.issueNumber);
      const payload: GitHubIssuesWebhookPayload = {
        action: event.action,
        // GitHub leaves `closed_by` out of the issue in a webhook payload (measured live, ticket #32).
        issue: webhookIssue(renderer.issue(record)),
        ...(event.changes ? { changes: event.changes } : {}),
        ...(event.label ? { label: renderer.label(event.label) } : {}),
        ...(event.assignee ? { assignee: renderer.user(event.assignee) } : {}),
        sender: renderer.user(event.sender),
        repository: renderer.repository(null),
        organization: { ...renderer.user(this.#store.orgAccount) },
      };
      this.#deps.webhooks.emit(payload);
    }
  }

  /** A writer for tests and seeding that fires no webhooks: deletes need the snapshot, others do not. */
  emitDeleted(event: IssueEvent, snapshot: IssueRecord): void {
    this.#emit([event], snapshot);
  }

  emitEvents(events: IssueEvent[]): void {
    this.#emit(events);
  }

  // ------------------------------------------------------------------------------------- routes

  #routes(): void {
    const r = this.#router;
    const repoBase = "/repos/:owner/:repo";

    r.add("GET", "/user", (c) => {
      const actor = this.#authenticate(c.request);
      return jsonResponse(this.#renderer(c.url).user(actor.account));
    });

    r.add("GET", "/users/:login", (c) => {
      this.#authenticate(c.request);
      const account = this.#store.accountByLogin(c.params["login"] as string);
      if (!account) throw new GitHubFailure(404, "Not Found");
      return jsonResponse(this.#renderer(c.url).user(account));
    });

    // The authenticated App (a JWT): its slug is what the Bot's login `<slug>[bot]` is made of.
    r.add("GET", "/app", async (c) => {
      await this.#verifyAppJwt(c.request);
      const { appId, slug } = this.#deps.bot;
      return jsonResponse({
        id: appId,
        client_id: this.#deps.bot.clientId,
        slug,
        name: slug,
        node_id: `A_${appId}`,
      });
    });

    r.add("POST", "/app/installations/:id/access_tokens", async (c) => {
      await this.#verifyAppJwt(c.request);
      if (Number(c.params["id"]) !== this.#deps.bot.installationId) {
        throw new GitHubFailure(404, "Not Found");
      }
      const { token, expiresAt } = this.#deps.tokens.mintInstallation(this.#store.botAccount.login);
      return jsonResponse(
        {
          token,
          expires_at: isoSeconds(expiresAt),
          permissions: { issues: "write", metadata: "read" },
          repository_selection: "selected",
        },
        201,
      );
    });

    r.add("GET", repoBase, (c) => {
      const actor = this.#member(c);
      return jsonResponse({
        ...this.#renderer(c.url).repository(actor.role),
        // An installation token's repo `permissions` are all false: its rights are in the token, not the repo.
        permissions: permissionsFor(actor.account.type === "Bot" ? "none" : actor.role),
      });
    });

    // ---- issues. Repo-wide comment routes come first: "comments" would otherwise match `:number`.
    r.add("GET", `${repoBase}/issues/comments`, (c) => {
      this.#member(c);
      const renderer = this.#renderer(c.url);
      const since = parseSince(c.url);
      let comments = [...this.#store.comments.values()].filter(
        (comment) => since === null || comment.updatedAt >= since,
      );
      const sort = c.url.searchParams.get("sort") === "updated" ? "updated" : "created";
      comments = sortBy(
        comments,
        (comment): [number, number] => [
          sort === "updated" ? comment.updatedAt : comment.createdAt,
          comment.id,
        ],
        c.url.searchParams.get("direction"),
        "asc",
      );
      return paged(
        c.url,
        comments.map((comment) => withHtml(c.request, renderer.comment(comment))),
      );
    });

    r.add("GET", `${repoBase}/issues/comments/:id`, (c) => {
      this.#member(c);
      return jsonResponse(
        withHtml(
          c.request,
          this.#renderer(c.url).comment(this.#store.comment(Number(c.params["id"]))),
        ),
      );
    });

    r.add("PATCH", `${repoBase}/issues/comments/:id`, async (c) => {
      const actor = this.#member(c);
      const comment = this.#store.comment(Number(c.params["id"]));
      this.#mayEditComment(actor, comment.author);
      const body = asObject(await readJson(c.request));
      if (typeof body["body"] !== "string" || body["body"] === "")
        throw validation("body", "missing_field", "IssueComment");
      return jsonResponse(
        this.#renderer(c.url).comment(this.#store.updateComment(comment.id, body["body"])),
      );
    });

    r.add("DELETE", `${repoBase}/issues/comments/:id`, (c) => {
      const actor = this.#member(c);
      const comment = this.#store.comment(Number(c.params["id"]));
      this.#mayEditComment(actor, comment.author);
      this.#store.deleteComment(comment.id);
      return new Response(null, { status: 204 });
    });

    r.add("GET", `${repoBase}/issues`, (c) => {
      this.#member(c);
      const renderer = this.#renderer(c.url);
      const q = c.url.searchParams;
      const state = q.get("state") ?? "open";
      if (!["open", "closed", "all"].includes(state)) throw validation("state", "invalid");
      const labels = (q.get("labels") ?? "")
        .split(",")
        .filter(Boolean)
        .map((name) => name.toLowerCase());
      const since = parseSince(c.url);
      const assignee = q.get("assignee");
      const creator = q.get("creator");
      let issues = [...this.#store.issues.values()].filter((issue) => {
        if (state !== "all" && issue.state !== state) return false;
        const names = issue.labels.map((name) => name.toLowerCase());
        if (!labels.every((label) => names.includes(label))) return false;
        if (since !== null && issue.updatedAt < since) return false;
        if (creator && issue.author !== creator) return false;
        if (assignee === "none" && issue.assignees.length > 0) return false;
        if (assignee === "*" && issue.assignees.length === 0) return false;
        if (
          assignee &&
          assignee !== "none" &&
          assignee !== "*" &&
          !issue.assignees.includes(assignee)
        )
          return false;
        return true;
      });
      const sort = q.get("sort") ?? "created";
      const key = (issue: IssueRecord) =>
        sort === "updated"
          ? issue.updatedAt
          : sort === "comments"
            ? this.#store.commentsOn(issue.number).length
            : issue.createdAt;
      // Equal timestamps (the same second) fall back to the number so the order is stable.
      issues = sortBy(
        issues,
        (issue): [number, number] => [key(issue), issue.number],
        q.get("direction"),
        "desc",
      );
      return paged(
        c.url,
        issues.map((issue) => renderer.issue(issue)),
      );
    });

    r.add("POST", `${repoBase}/issues`, async (c) => {
      const actor = this.#member(c);
      const body = asObject(await readJson(c.request));
      const title = body["title"];
      if (typeof title !== "string" || title.trim() === "")
        throw validation("title", "missing_field");
      const { issue, events } = this.#store.createIssue(actor, {
        title,
        body: optionalString(body["body"], "body", true) ?? null,
        labels: stringList(body["labels"], "labels") ?? [],
        assignees: stringList(body["assignees"], "assignees") ?? [],
      });
      this.#emit(events);
      return jsonResponse(this.#renderer(c.url).issue(issue), 201);
    });

    r.add("GET", `${repoBase}/issues/:number`, (c) => {
      this.#member(c);
      return jsonResponse(
        withHtml(
          c.request,
          this.#renderer(c.url).issue(this.#store.issue(Number(c.params["number"]))),
        ),
      );
    });

    r.add("PATCH", `${repoBase}/issues/:number`, async (c) => {
      const actor = this.#member(c, "triage");
      const body = asObject(await readJson(c.request));
      const state = body["state"];
      if (state !== undefined && state !== "open" && state !== "closed")
        throw validation("state", "invalid");
      const reason = body["state_reason"];
      if (reason !== undefined && !STATE_REASONS.includes(reason as StateReason | null)) {
        throw validation("state_reason", "invalid");
      }
      const title = optionalString(body["title"], "title");
      if (title === "") throw validation("title", "missing_field");
      const duplicate = body["duplicate_issue_id"];
      if (duplicate !== undefined && !Number.isInteger(duplicate))
        throw validation("duplicate_issue_id", "invalid");
      const { issue, events } = this.#store.updateIssue(actor, Number(c.params["number"]), {
        ...(title !== undefined ? { title: title as string } : {}),
        ...(body["body"] !== undefined ? { body: optionalString(body["body"], "body", true) } : {}),
        ...(state !== undefined ? { state } : {}),
        ...(reason !== undefined ? { state_reason: reason as StateReason | null } : {}),
        ...(duplicate !== undefined ? { duplicate_issue_id: duplicate as number } : {}),
        ...(body["labels"] !== undefined
          ? { labels: stringList(body["labels"], "labels") ?? [] }
          : {}),
        ...(body["assignees"] !== undefined
          ? { assignees: stringList(body["assignees"], "assignees") ?? [] }
          : {}),
      });
      this.#emit(events);
      return jsonResponse(this.#renderer(c.url).issue(issue));
    });

    r.add("GET", `${repoBase}/issues/:number/comments`, (c) => {
      this.#member(c);
      const number = Number(c.params["number"]);
      this.#store.issue(number);
      const since = parseSince(c.url);
      const renderer = this.#renderer(c.url);
      const comments = this.#store
        .commentsOn(number)
        .filter((comment) => since === null || comment.updatedAt >= since);
      return paged(
        c.url,
        comments.map((comment) => withHtml(c.request, renderer.comment(comment))),
      );
    });

    r.add("POST", `${repoBase}/issues/:number/comments`, async (c) => {
      const actor = this.#member(c);
      const body = asObject(await readJson(c.request));
      if (typeof body["body"] !== "string" || body["body"] === "") {
        throw validation("body", "missing_field", "IssueComment");
      }
      const comment = this.#store.createComment(
        actor.account,
        Number(c.params["number"]),
        body["body"],
      );
      return jsonResponse(this.#renderer(c.url).comment(comment), 201);
    });

    r.add("GET", `${repoBase}/issues/:number/timeline`, (c) => {
      this.#member(c);
      const number = Number(c.params["number"]);
      this.#store.issue(number);
      const exclude = new Set((c.url.searchParams.get("exclude") ?? "").split(",").filter(Boolean));
      const renderer = this.#renderer(c.url);
      const events = this.#store.timeline
        .filter((record) => record.issueNumber === number && !exclude.has(record.event))
        .flatMap((record) => {
          const rendered = renderer.timelineEvent(record);
          return rendered ? [rendered] : [];
        });
      return paged(c.url, events);
    });

    // The users an issue can be assigned to: here, the members who can triage (not the Bot).
    r.add("GET", `${repoBase}/assignees`, (c) => {
      this.#member(c);
      const renderer = this.#renderer(c.url);
      return paged(
        c.url,
        [...this.#store.staff.values()]
          .filter((member) => roleRank(member.role) >= roleRank("triage"))
          .map((member) => renderer.user(member.account)),
      );
    });

    // ---- collaborators and repository invitations (ADR 0006)
    r.add("GET", `${repoBase}/collaborators`, (c) => {
      this.#requireAdministration(c, "write");
      const affiliation = c.url.searchParams.get("affiliation") ?? "all";
      if (affiliation !== "all" && affiliation !== "direct" && affiliation !== "outside") {
        throw validation("affiliation", "invalid", "Collaborator");
      }
      const renderer = this.#renderer(c.url);
      return paged(
        c.url,
        this.#store.collaborators(affiliation).map((member) => renderer.collaborator(member)),
      );
    });

    r.add("GET", `${repoBase}/collaborators/:username/permission`, (c) => {
      this.#requireAdministration(c, "write");
      const member = this.#store.collaboratorPermission(c.params["username"] as string);
      return jsonResponse(this.#renderer(c.url).collaboratorPermission(member));
    });

    r.add("PUT", `${repoBase}/collaborators/:username`, async (c) => {
      const actor = this.#requireAdministration(c, "admin");
      const body = asObject(await readJson(c.request));
      const raw = body["permission"] === undefined ? "push" : body["permission"];
      if (typeof raw !== "string" || !(raw in COLLABORATOR_PERMISSIONS)) {
        throw validation("permission", "invalid", "Collaborator");
      }
      const result = this.#store.addOrUpdateCollaborator(
        actor.account,
        c.params["username"] as string,
        COLLABORATOR_PERMISSIONS[raw]!,
      );
      if (result.status === 204) return new Response(null, { status: 204 });
      return jsonResponse(this.#renderer(c.url).invitation(result.invitation), 201);
    });

    r.add("DELETE", `${repoBase}/collaborators/:username`, (c) => {
      const actor = this.#requireAdministration(c, "admin");
      this.#store.removeCollaborator(actor.account, c.params["username"] as string);
      return new Response(null, { status: 204 });
    });

    r.add("GET", `${repoBase}/invitations`, (c) => {
      this.#requireAdministration(c, "admin");
      const renderer = this.#renderer(c.url);
      return paged(
        c.url,
        this.#store.listInvitations().map((invitation) => renderer.invitation(invitation)),
      );
    });

    r.add("PATCH", `${repoBase}/invitations/:id`, async (c) => {
      this.#requireAdministration(c, "admin");
      const body = asObject(await readJson(c.request));
      const permissions = body["permissions"];
      if (
        typeof permissions !== "string" ||
        !INVITATION_PERMISSIONS.includes(permissions as GitHubInvitationPermission)
      ) {
        throw validation("permissions", "invalid", "RepositoryInvitation");
      }
      const updated = this.#store.updateInvitation(
        Number(c.params["id"]),
        permissions as GitHubInvitationPermission,
      );
      return jsonResponse(this.#renderer(c.url).invitation(updated));
    });

    r.add("DELETE", `${repoBase}/invitations/:id`, (c) => {
      this.#requireAdministration(c, "admin");
      this.#store.deleteInvitation(Number(c.params["id"]));
      return new Response(null, { status: 204 });
    });

    // ---- labels
    r.add("GET", `${repoBase}/labels`, (c) => {
      this.#member(c);
      const renderer = this.#renderer(c.url);
      return paged(
        c.url,
        [...this.#store.labels.values()].map((label) => renderer.label(label)),
      );
    });

    r.add("POST", `${repoBase}/labels`, async (c) => {
      this.#member(c, "triage");
      const body = asObject(await readJson(c.request));
      if (typeof body["name"] !== "string" || body["name"] === "")
        throw validation("name", "missing_field", "Label");
      const label = this.#store.createLabel(
        body["name"],
        optionalString(body["color"], "color") ?? undefined,
        optionalString(body["description"], "description", true),
      );
      return jsonResponse(this.#renderer(c.url).label(label), 201);
    });

    r.add("DELETE", `${repoBase}/labels/:name`, (c) => {
      this.#member(c, "triage");
      this.#store.deleteLabel(c.params["name"] as string);
      return new Response(null, { status: 204 });
    });

    r.add("GET", `${repoBase}/labels/:name`, (c) => {
      this.#member(c);
      const label = this.#store.label(c.params["name"] as string);
      if (!label) throw new GitHubFailure(404, "Not Found");
      return jsonResponse(this.#renderer(c.url).label(label));
    });

    r.add("PATCH", `${repoBase}/labels/:name`, async (c) => {
      this.#member(c, "triage");
      const body = asObject(await readJson(c.request));
      const label = this.#store.updateLabel(c.params["name"] as string, {
        ...(body["new_name"] !== undefined
          ? { new_name: optionalString(body["new_name"], "new_name") as string }
          : {}),
        ...(body["color"] !== undefined
          ? { color: optionalString(body["color"], "color") as string }
          : {}),
        ...(body["description"] !== undefined
          ? {
              description: optionalString(body["description"], "description", true),
            }
          : {}),
      });
      return jsonResponse(this.#renderer(c.url).label(label));
    });

    // ---- search
    r.add("GET", "/search/issues", (c) => {
      const actor = this.#authenticate(c.request);
      if (actor.role === "none")
        return jsonResponse({ total_count: 0, incomplete_results: false, items: [] });
      const query = c.url.searchParams.get("q");
      if (!query) throw validation("q", "missing", "Search");
      const matches = searchIssues(this.#store, query);
      const order = c.url.searchParams.get("order");
      const sort = c.url.searchParams.get("sort");
      const key = (issue: IssueRecord) =>
        sort === "updated"
          ? issue.updatedAt
          : sort === "comments"
            ? this.#store.commentsOn(issue.number).length
            : issue.createdAt;
      const sorted = sortBy(
        matches,
        (issue): [number, number] => [key(issue), issue.number],
        order,
        "desc",
      );
      const renderer = this.#renderer(c.url);
      const { page, link } = paginate(c.url, sorted);
      return jsonResponse(
        {
          total_count: sorted.length,
          incomplete_results: false,
          items: page.map((issue) => renderer.issue(issue)),
        },
        200,
        link ? { link } : {},
      );
    });
  }

  #mayEditComment(actor: Actor, author: string): void {
    if (actor.account.login === author || roleRank(actor.role) >= roleRank("write")) return;
    throw new GitHubFailure(403, "Resource not accessible by integration");
  }

  /** Checks the App JWT as GitHub does: RS256, the App's key, `iss`, and a lifetime of at most 10 minutes. */
  async #verifyAppJwt(request: Request): Promise<void> {
    // GitHub's messages, as observed against the live API (contract suite, ticket #32): most failures are a bare
    // "Bad credentials", and only a few say what is wrong.
    const header = request.headers.get("authorization");
    if (!header) throw new GitHubFailure(401, "Requires authentication");
    const token = /^bearer\s+(\S+)$/i.exec(header)?.[1];
    const bad = () => new GitHubFailure(401, "Bad credentials");
    if (!token) throw bad();
    const parts = token.split(".");
    if (parts.length !== 3) throw bad();
    const [head, claimsPart, signature] = parts as [string, string, string];
    let parsedHeader: Json;
    let claims: Json;
    try {
      parsedHeader = JSON.parse(new TextDecoder().decode(fromBase64Url(head))) as Json;
      claims = JSON.parse(new TextDecoder().decode(fromBase64Url(claimsPart))) as Json;
    } catch {
      throw bad();
    }
    if (parsedHeader["alg"] !== "RS256") throw bad();
    this.#publicKey ??= importPublicKey(this.#deps.bot.publicKey);
    let valid: boolean;
    try {
      valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        await this.#publicKey,
        fromBase64Url(signature),
        new TextEncoder().encode(`${head}.${claimsPart}`),
      );
    } catch {
      valid = false;
    }
    if (!valid) throw new GitHubFailure(401, "A JSON web token could not be decoded");
    const { appId, clientId } = this.#deps.bot;
    // JWTs are signed on the Worker's real clock, so they are checked on it too (not the fake's offset).
    const now = Math.floor(Date.now() / 1000);
    const { iat, exp } = claims as { iat?: unknown; exp?: unknown };
    if (typeof iat !== "number") {
      throw new GitHubFailure(401, "Missing 'issued at' claim ('iat') in assertion");
    }
    if (typeof exp !== "number" || exp <= now || iat > now + 60) throw bad();
    if (exp - iat > 660) {
      throw new GitHubFailure(401, "'Expiration time' claim ('exp') is too far in the future");
    }
    if (claims["iss"] !== String(appId) && claims["iss"] !== clientId) {
      throw new GitHubFailure(404, "Integration not found");
    }
  }
}

/** The path the fake is mounted under, taken from the URL the client called: `/github` or empty. */
function apiPrefix(url: URL): string {
  return url.pathname.startsWith("/github/") || url.pathname === "/github" ? "/github" : "";
}

function webhookIssue(issue: GitHubIssue): GitHubIssuesWebhookPayload["issue"] {
  const { closed_by: _closedBy, ...rest } = issue;
  return rest as GitHubIssuesWebhookPayload["issue"];
}

/** Adds `body_html` to a rendered issue or comment when the caller's `Accept` asks for rendered bodies. */
function withHtml<T extends { body?: string | null }>(request: Request, item: T): T {
  if (!wantsHtml(request.headers.get("accept"))) return item;
  return { ...item, body_html: renderMarkdown(item.body ?? "") };
}

function paged(url: URL, items: unknown[]): Response {
  const { page, link } = paginate(url, items);
  return jsonResponse(page, 200, link ? { link } : {});
}

function parseSince(url: URL): number | null {
  const since = url.searchParams.get("since");
  if (since === null) return null;
  const time = Date.parse(since);
  if (Number.isNaN(time)) throw validation("since", "invalid");
  return time;
}

const EXPOSED_HEADERS =
  "ETag, Link, Location, Retry-After, X-GitHub-OTP, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource, X-RateLimit-Reset, X-OAuth-Scopes, X-Accepted-OAuth-Scopes, X-Poll-Interval, X-GitHub-Media-Type, X-GitHub-SSO, X-GitHub-Request-Id, Deprecation, Sunset";

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-expose-headers", EXPOSED_HEADERS);
  headers.set("x-github-api-version-selected", GITHUB_API_VERSION);
  headers.set("vary", "Accept, Authorization, Cookie, X-GitHub-OTP");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE",
      "access-control-allow-headers":
        "Authorization, Content-Type, If-Match, If-Modified-Since, If-None-Match, If-Unmodified-Since, Accept-Encoding, X-GitHub-OTP, X-Requested-With, GraphQL-Features, X-GitHub-Api-Version",
      "access-control-max-age": "86400",
      "access-control-expose-headers": EXPOSED_HEADERS,
    },
  });
}
