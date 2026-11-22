import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import type { StatusCommentItem, StatusView } from "@shared/status/view.ts";
import {
  appendStatusCommentToCache,
  clearConfirmedStatusComments,
  mergeConfirmedStatusComments,
} from "./status-cache.ts";

const TOKEN = "8s2Qn1vYt0xk7ZcLw3HfPA";

function view(overrides: Partial<StatusView> = {}): StatusView {
  return {
    number: 12,
    title: "Elakadt a lift",
    body: { kind: "report", place: "B lépcsőház", description: "Megállt." },
    state: "open",
    closeReason: null,
    status: "new",
    category: "elevator",
    location: "stairwell",
    assigned: false,
    createdAt: "2026-03-02T08:00:00Z",
    updatedAt: "2026-03-02T08:00:00Z",
    closedAt: null,
    timeline: [],
    ...overrides,
  };
}

const reporterComment = (text: string, at: string): StatusCommentItem => ({
  kind: "comment",
  author: "reporter",
  text,
  at,
});

afterEach(() => {
  clearConfirmedStatusComments();
});

describe("appendStatusCommentToCache and mergeConfirmedStatusComments", () => {
  it("appends the created comment immediately and preserves it across stale lookups until fetched", () => {
    const queryClient = new QueryClient();
    const initial = view();
    queryClient.setQueryData(["status", TOKEN], initial);

    const created = reporterComment("Még mindig áll.", "2026-03-02T09:10:00Z");
    appendStatusCommentToCache(queryClient, TOKEN, created, () => 1_000);

    const cached = queryClient.getQueryData<StatusView>(["status", TOKEN]);
    expect(cached?.timeline).toEqual([created]);
    expect(cached?.updatedAt).toBe("2026-03-02T09:10:00Z");

    // A stale lookup (e.g. from another edge PoP) preserves the confirmed comment.
    const mergedStale = mergeConfirmedStatusComments(TOKEN, initial, () => 5_000);
    expect(mergedStale.timeline).toEqual([created]);
    expect(mergedStale.updatedAt).toBe("2026-03-02T09:10:00Z");

    // Once the lookup returns the comment, it is not duplicated and is evicted from pending memory.
    const freshFromServer = view({
      updatedAt: "2026-03-02T09:10:00Z",
      timeline: [created],
    });
    const mergedFresh = mergeConfirmedStatusComments(TOKEN, freshFromServer, () => 6_000);
    expect(mergedFresh.timeline).toEqual([created]);

    // Subsequent lookup without it no longer re-injects it.
    expect(mergeConfirmedStatusComments(TOKEN, initial, () => 7_000).timeline).toEqual([]);
  });

  it("matches duplicate identical-text comments in the same second by occurrence count", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["status", TOKEN], view());

    const c1 = reporterComment("Ping", "2026-03-02T09:10:00Z");
    const c2 = reporterComment("Ping", "2026-03-02T09:10:00Z");
    appendStatusCommentToCache(queryClient, TOKEN, c1, () => 1_000);
    appendStatusCommentToCache(queryClient, TOKEN, c2, () => 1_500);

    expect(queryClient.getQueryData<StatusView>(["status", TOKEN])?.timeline).toEqual([c1, c2]);

    // Fetched view has only 1 of the two identical comments: keeps the second pending.
    const partial = mergeConfirmedStatusComments(TOKEN, view({ timeline: [c1] }), () => 2_000);
    expect(partial.timeline).toEqual([c1, c2]);

    // Fetched view has both: neither is duplicated, both evicted.
    const both = mergeConfirmedStatusComments(TOKEN, view({ timeline: [c1, c2] }), () => 3_000);
    expect(both.timeline).toEqual([c1, c2]);
    expect(mergeConfirmedStatusComments(TOKEN, view(), () => 4_000).timeline).toEqual([]);
  });

  it("expires pending entries after 60 s and clears on token reissue", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["status", TOKEN], view());

    let now = 10_000;
    const c1 = reporterComment("Első", "2026-03-02T09:10:00Z");
    appendStatusCommentToCache(queryClient, TOKEN, c1, () => now);
    now += 60_000;
    expect(mergeConfirmedStatusComments(TOKEN, view(), () => now).timeline).toEqual([]);

    const c2 = reporterComment("Második", "2026-03-02T09:12:00Z");
    appendStatusCommentToCache(queryClient, TOKEN, c2, () => now);
    clearConfirmedStatusComments(TOKEN);
    expect(mergeConfirmedStatusComments(TOKEN, view(), () => now).timeline).toEqual([]);
  });
});
