import type { GitHubComment, GitHubIssue, GitHubTimelineEvent } from "@shared/github/types.ts";

interface Repo {
  owner: string;
  name: string;
}

interface ConfirmedCommentEntry {
  comment: GitHubComment;
  recordedAt: number;
}

const CONFIRMED_COMMENT_TTL_MS = 60_000;
const MAX_CONFIRMED_ISSUES = 50;

const confirmed = new Map<string, ConfirmedCommentEntry[]>();

const keyOf = (repo: Repo, number: number) => `${repo.owner}/${repo.name}#${number}`;

function pruneEntries(
  entries: ConfirmedCommentEntry[],
  currentTime: number,
): ConfirmedCommentEntry[] {
  return entries.filter((entry) => currentTime - entry.recordedAt < CONFIRMED_COMMENT_TTL_MS);
}

/** Converts a `GitHubComment` returned by `POST /issues/:n/comments` into a `commented` timeline event. */
export function commentToTimelineEvent(comment: GitHubComment): GitHubTimelineEvent {
  return { ...comment, event: "commented", actor: comment.user };
}

/** Returns `candidate` when it is a valid timestamp strictly newer than `current` (or when `current` is invalid). */
export function newerTimestamp(current: string, candidate: string | undefined): string {
  if (!candidate) return current;
  const candidateMs = Date.parse(candidate);
  if (Number.isNaN(candidateMs)) return current;
  const currentMs = Date.parse(current);
  return Number.isNaN(currentMs) || candidateMs > currentMs ? candidate : current;
}

/** Records a newly created comment so concurrent or slightly stale timeline refetches cannot drop it. */
export function recordConfirmedComment(
  repo: Repo,
  number: number,
  comment: GitHubComment,
  now: () => number = Date.now,
): void {
  const currentTime = now();
  const key = keyOf(repo, number);
  const existing = pruneEntries(confirmed.get(key) ?? [], currentTime).filter(
    (entry) => entry.comment.id !== comment.id,
  );
  if (confirmed.has(key)) {
    confirmed.delete(key);
  } else if (confirmed.size >= MAX_CONFIRMED_ISSUES) {
    const oldest = confirmed.keys().next().value;
    if (oldest !== undefined) confirmed.delete(oldest);
  }
  confirmed.set(key, [...existing, { comment, recordedAt: currentTime }]);
}

/**
 * Merges any recently confirmed comments missing from a fetched Detail payload and evicts entries once GitHub
 * returns them on read, so a deleted comment is never resurrected later.
 */
export function mergeConfirmedComments(
  repo: Repo,
  number: number,
  fetched: { issue: GitHubIssue; timeline: GitHubTimelineEvent[] },
  now: () => number = Date.now,
): { issue: GitHubIssue; timeline: GitHubTimelineEvent[] } {
  const key = keyOf(repo, number);
  const entries = pruneEntries(confirmed.get(key) ?? [], now());
  if (entries.length === 0) {
    confirmed.delete(key);
    return fetched;
  }

  const presentIds = new Set<number>();
  for (const event of fetched.timeline) {
    if (event.event === "commented") presentIds.add(event.id);
  }

  const missing = entries.filter((entry) => !presentIds.has(entry.comment.id));
  if (missing.length === 0) {
    confirmed.delete(key);
    return fetched;
  }
  confirmed.set(key, missing);

  const timeline = [
    ...fetched.timeline,
    ...missing.map((entry) => commentToTimelineEvent(entry.comment)),
  ];
  const mergedCommentCount = timeline.filter((event) => event.event === "commented").length;
  let updatedAt = fetched.issue.updated_at;
  for (const entry of missing) {
    updatedAt = newerTimestamp(updatedAt, entry.comment.updated_at || entry.comment.created_at);
  }

  return {
    issue: {
      ...fetched.issue,
      comments: Math.max(fetched.issue.comments ?? 0, mergedCommentCount),
      updated_at: updatedAt,
    },
    timeline,
  };
}

/** Clears stored confirmed comments (intended for tests). */
export function clearConfirmedComments(repo?: Repo, number?: number): void {
  if (repo !== undefined && number !== undefined) {
    confirmed.delete(keyOf(repo, number));
    return;
  }
  confirmed.clear();
}
