import { GitHubFailure, type GitHubStore, type IssueRecord } from "./store.ts";

/** Splits `label:"a b" word -label:x` into terms, keeping quoted values together. */
function tokenize(query: string): string[] {
  const terms: string[] = [];
  const pattern = /(?:[^\s"]+:)?"[^"]*"|\S+/g;
  for (const match of query.matchAll(pattern)) terms.push(match[0]);
  return terms;
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

interface ParsedQuery {
  kind: "issue" | "pull-request" | null;
  state: "open" | "closed" | null;
  labels: string[];
  notLabels: string[];
  author: string | null;
  assignee: string | null;
  inFields: Set<string>;
  words: string[];
}

function parse(query: string, store: GitHubStore): ParsedQuery {
  const parsed: ParsedQuery = {
    kind: null,
    state: null,
    labels: [],
    notLabels: [],
    author: null,
    assignee: null,
    inFields: new Set(),
    words: [],
  };
  const fullName = `${store.options.org}/${store.options.repo}`.toLowerCase();
  for (const term of tokenize(query)) {
    const negated = term.startsWith("-");
    const colon = term.indexOf(":");
    const qualifier = colon === -1 ? null : term.slice(negated ? 1 : 0, colon).toLowerCase();
    const value = colon === -1 ? term : unquote(term.slice(colon + 1));
    switch (qualifier) {
      case null:
        parsed.words.push(unquote(term).toLowerCase());
        break;
      case "repo":
        // Only the one repo exists; another repo has no results.
        if (value.toLowerCase() !== fullName) parsed.words.push("\u0000no-such-repo");
        break;
      case "is":
        if (value === "issue") parsed.kind = "issue";
        else if (value === "pr" || value === "pull-request") parsed.kind = "pull-request";
        else if (value === "open" || value === "closed") parsed.state = value;
        break;
      case "state":
        if (value === "open" || value === "closed") parsed.state = value;
        break;
      case "type":
        if (value === "issue") parsed.kind = "issue";
        else if (value === "pr") parsed.kind = "pull-request";
        break;
      case "label":
        (negated ? parsed.notLabels : parsed.labels).push(value.toLowerCase());
        break;
      case "author":
        parsed.author = value.toLowerCase();
        break;
      case "assignee":
        parsed.assignee = value.toLowerCase();
        break;
      case "in":
        for (const field of value.split(",")) parsed.inFields.add(field);
        break;
      default:
        // An unsupported qualifier narrows nothing here; the real index would, so keep it visible.
        throw new GitHubFailure(422, "Validation Failed", [
          {
            resource: "Search",
            field: "q",
            code: "invalid",
            message: `The fake GitHub does not implement the search qualifier "${qualifier}:"`,
          },
        ]);
    }
  }
  return parsed;
}

/**
 * The slice of GitHub's issue search the design uses (SPEC 2.4): `repo:`, `is:`, `label:`, `author:`,
 * `assignee:`, `in:` and free words. Like GitHub, it refuses a query without `is:issue` or `is:pull-request`
 * (a 422 for GitHub-App user tokens, which is what Staff use). The real index lags behind writes; the fake
 * answers from the live state, so "search is not proof of absence" (ADR 0005) is not exercised here.
 */
export function searchIssues(store: GitHubStore, query: string): IssueRecord[] {
  const parsed = parse(query, store);
  if (parsed.kind === null) {
    throw new GitHubFailure(422, "Validation Failed", [
      {
        resource: "Search",
        field: "q",
        code: "invalid",
        message: "Query must include 'is:issue' or 'is:pull-request'",
      },
    ]);
  }
  const fields = parsed.inFields.size > 0 ? parsed.inFields : new Set(["title", "body"]);
  return [...store.issues.values()].filter((issue) => {
    if ((parsed.kind === "pull-request") !== issue.isPullRequest) return false;
    if (parsed.state && issue.state !== parsed.state) return false;
    const labels = issue.labels.map((label) => label.toLowerCase());
    if (!parsed.labels.every((label) => labels.includes(label))) return false;
    if (parsed.notLabels.some((label) => labels.includes(label))) return false;
    if (parsed.author && issue.author.toLowerCase() !== parsed.author) return false;
    if (
      parsed.assignee &&
      !issue.assignees.some((login) => login.toLowerCase() === parsed.assignee)
    ) {
      return false;
    }
    const haystack = [
      fields.has("title") ? issue.title : "",
      fields.has("body") ? (issue.body ?? "") : "",
      fields.has("comments")
        ? store
            .commentsOn(issue.number)
            .map((comment) => comment.body)
            .join("\n")
        : "",
    ]
      .join("\n")
      .toLowerCase();
    return parsed.words.every((word) => haystack.includes(word));
  });
}
