import type { QueryClient } from "@tanstack/react-query";
import type { StatusCommentItem, StatusView } from "@shared/status/view.ts";

interface ConfirmedStatusCommentEntry {
  comment: StatusCommentItem;
  recordedAt: number;
}

const CONFIRMED_STATUS_COMMENT_TTL_MS = 60_000;
const MAX_CONFIRMED_TOKENS = 50;

const confirmed = new Map<string, ConfirmedStatusCommentEntry[]>();

function pruneEntries(
  entries: ConfirmedStatusCommentEntry[],
  currentTime: number,
): ConfirmedStatusCommentEntry[] {
  return entries.filter(
    (entry) => currentTime - entry.recordedAt < CONFIRMED_STATUS_COMMENT_TTL_MS,
  );
}

function newerTimestamp(current: string, candidate: string | undefined): string {
  if (!candidate) return current;
  const candidateMs = Date.parse(candidate);
  if (Number.isNaN(candidateMs)) return current;
  const currentMs = Date.parse(current);
  return Number.isNaN(currentMs) || candidateMs > currentMs ? candidate : current;
}

const signatureOf = (item: Pick<StatusCommentItem, "author" | "at" | "text">) =>
  JSON.stringify([item.author, item.at, item.text]);

/**
 * Appends a newly created allowlisted comment into the cached Status view immediately and remembers it so a
 * subsequent lookup served from a stale edge cache cannot drop the comment the Reporter just posted.
 */
export function appendStatusCommentToCache(
  queryClient: QueryClient,
  token: string,
  comment: StatusCommentItem,
  now: () => number = Date.now,
): void {
  const currentTime = now();
  const existing = pruneEntries(confirmed.get(token) ?? [], currentTime);
  if (confirmed.has(token)) {
    confirmed.delete(token);
  } else if (confirmed.size >= MAX_CONFIRMED_TOKENS) {
    const oldest = confirmed.keys().next().value;
    if (oldest !== undefined) confirmed.delete(oldest);
  }
  confirmed.set(token, [...existing, { comment, recordedAt: currentTime }]);

  queryClient.setQueryData<StatusView>(["status", token], (current) =>
    current
      ? {
          ...current,
          updatedAt: newerTimestamp(current.updatedAt, comment.at),
          timeline: [...current.timeline, comment],
        }
      : current,
  );
}

/**
 * Preserves recently posted comments if a fetched `StatusView` omits them (e.g. an edge cache on another PoP),
 * and evicts matched entries by `(author, at, text)` count once the fetched timeline includes them.
 */
export function mergeConfirmedStatusComments(
  token: string,
  fetched: StatusView,
  now: () => number = Date.now,
): StatusView {
  const entries = pruneEntries(confirmed.get(token) ?? [], now());
  if (entries.length === 0) {
    confirmed.delete(token);
    return fetched;
  }

  const fetchedCounts = new Map<string, number>();
  for (const item of fetched.timeline) {
    if (item.kind !== "comment") continue;
    const sig = signatureOf(item);
    fetchedCounts.set(sig, (fetchedCounts.get(sig) ?? 0) + 1);
  }

  const missing: ConfirmedStatusCommentEntry[] = [];
  for (const entry of entries) {
    const sig = signatureOf(entry.comment);
    const remaining = fetchedCounts.get(sig) ?? 0;
    if (remaining > 0) {
      fetchedCounts.set(sig, remaining - 1);
    } else {
      missing.push(entry);
    }
  }

  if (missing.length === 0) {
    confirmed.delete(token);
    return fetched;
  }
  confirmed.set(token, missing);

  let updatedAt = fetched.updatedAt;
  for (const entry of missing) {
    updatedAt = newerTimestamp(updatedAt, entry.comment.at);
  }
  return {
    ...fetched,
    updatedAt,
    timeline: [...fetched.timeline, ...missing.map((entry) => entry.comment)],
  };
}

/** Clears confirmed status comments for one token (e.g. after Reissue) or all tokens (for tests). */
export function clearConfirmedStatusComments(token?: string): void {
  if (token !== undefined) {
    confirmed.delete(token);
    return;
  }
  confirmed.clear();
}
