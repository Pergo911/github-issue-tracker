import { queryOptions } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { endpoints } from "@shared/api/endpoints.ts";
import { callApi } from "@/api/call-api.ts";
import { githubApiBase } from "@/github/api-base.ts";
import { createStaffSession } from "../github/session.ts";
import { tokenStore, type StoredTokens } from "./token-store.ts";

/**
 * The app's one Staff session: the browser's token store, the SPA's GitHub base and the Worker's refresh
 * endpoint wired together. Everything under `staff/` that talks to GitHub or to a gated endpoint goes through it.
 */
export const staffSession = createStaffSession({
  store: tokenStore,
  githubBase: githubApiBase(),
  refresh: (refreshToken) => callApi(endpoints.staffRefresh, { refreshToken }),
});

/** The stored tokens, or `null` when signed out; re-renders when they change (sign-in, refresh, sign-out). */
export function useTokens(): StoredTokens | null {
  return useSyncExternalStore(
    (listener) => tokenStore.subscribe(listener),
    () => tokenStore.read(),
  );
}

/** Role, login, repo and the expected Bot identity (the role-gated metadata endpoint). Not retried: a 403 is final. */
export const staffMetaQuery = queryOptions({
  queryKey: ["staff", "meta"],
  queryFn: () =>
    staffSession.withToken((token) => callApi(endpoints.staffMeta, undefined, { token })),
  retry: false,
  staleTime: 60_000,
});
