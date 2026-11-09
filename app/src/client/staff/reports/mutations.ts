import type { Dimension } from "@shared/config/schema.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import { dropStatus, setDimension } from "@shared/reports/labels.ts";
import type { CloseReason } from "@shared/status/view.ts";
import { GitHubHttpError, type StaffSession } from "../github/session.ts";

interface Repo {
  owner: string;
  name: string;
}

export type CloseChoice =
  | { reason: "fixed" | "rejected" }
  /** The original Report's number, as the member typed it. */
  | { reason: "duplicate"; duplicateOf: number };

/** The Report named as the original of a duplicate does not exist, is a pull request, or is the Report itself. */
export class DuplicateOriginalError extends Error {
  constructor() {
    super("The original Report of a duplicate was not found");
    this.name = "DuplicateOriginalError";
  }
}

const STATE_REASON: Record<Exclude<CloseReason, "duplicate">, "completed" | "not_planned"> = {
  fixed: "completed",
  rejected: "not_planned",
};

/**
 * The Detail view's writes (SPEC 2.4, 2.6), made with the signed-in member's own token. `PATCH` replaces the whole
 * label set, so every write that touches labels reads the Report fresh, changes only its own dimension and sends
 * one `PATCH`: another member's concurrent change survives, and GitHub never sees a Report with two Statuses or
 * none (a Status change, a close and a reopen are each a single call).
 */
export function createReportWrites(session: Pick<StaffSession, "githubFetch">) {
  const issuePath = (repo: Repo, number: number) =>
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues/${number}`;

  async function expectOk(response: Response): Promise<Response> {
    if (response.ok) return response;
    let message = `GitHub answered ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Keep the generic message.
    }
    throw new GitHubHttpError(response.status, message);
  }

  async function read(repo: Repo, number: number): Promise<GitHubIssue> {
    const response = await expectOk(await session.githubFetch(issuePath(repo, number)));
    return (await response.json()) as GitHubIssue;
  }

  async function patch(repo: Repo, number: number, body: Record<string, unknown>) {
    await expectOk(
      await session.githubFetch(issuePath(repo, number), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  /** Reads the labels as GitHub has them now and sends `change` of them in one PATCH, with `extra` fields. */
  async function relabel(
    repo: Repo,
    number: number,
    change: (labels: string[]) => string[],
    extra: Record<string, unknown> = {},
  ) {
    const fresh = await read(repo, number);
    await patch(repo, number, {
      ...extra,
      labels: change(fresh.labels.map((label) => label.name)),
    });
  }

  return {
    /** Category, Location, Priority or Status. A Status change also repairs an invalid Status. */
    setDimension: (repo: Repo, number: number, dimension: Dimension, id: string) =>
      relabel(repo, number, (labels) => setDimension(labels, dimension, id)),

    /** One PATCH: the state, the reason and the dropped Status label. */
    async close(repo: Repo, number: number, choice: CloseChoice) {
      let extra: Record<string, unknown>;
      if (choice.reason === "duplicate") {
        if (choice.duplicateOf === number) throw new DuplicateOriginalError();
        let original: GitHubIssue;
        try {
          original = await read(repo, choice.duplicateOf);
        } catch (error) {
          if (error instanceof GitHubHttpError && error.status === 404) {
            throw new DuplicateOriginalError();
          }
          throw error;
        }
        if (original.pull_request) throw new DuplicateOriginalError();
        // GitHub wants the original's database id, not its number.
        extra = { state: "closed", state_reason: "duplicate", duplicate_issue_id: original.id };
      } else {
        extra = { state: "closed", state_reason: STATE_REASON[choice.reason] };
      }
      await relabel(repo, number, dropStatus, extra);
    },

    /** One PATCH: the state and the Initial status. */
    reopen: (repo: Repo, number: number, initialStatus: string) =>
      relabel(repo, number, (labels) => setDimension(labels, "status", initialStatus), {
        state: "open",
      }),

    /** One assignee, or none. Touches no labels, so it reads nothing first. */
    assign: (repo: Repo, number: number, login: string | null) =>
      patch(repo, number, { assignees: login === null ? [] : [login] }),

    /** A comment as the signed-in member. */
    async comment(repo: Repo, number: number, text: string) {
      await expectOk(
        await session.githubFetch(`${issuePath(repo, number)}/comments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: text }),
        }),
      );
    },
  };
}

export type ReportWrites = ReturnType<typeof createReportWrites>;
