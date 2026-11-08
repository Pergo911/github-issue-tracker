import { queryOptions } from "@tanstack/react-query";
import { endpoints } from "@shared/api/endpoints.ts";
import { callApi } from "@/api/call-api.ts";

/**
 * The boot request: the unauthenticated public projection of the configuration. It is started before the
 * first render (main.tsx). Not retried on failure or on mount: the boot screen offers an explicit retry.
 */
export const publicConfigQuery = queryOptions({
  queryKey: ["config", "public"],
  // No abort signal on purpose: the boot request must run to completion, and React StrictMode's second mount
  // in development would otherwise cancel it and send it again.
  queryFn: () => callApi(endpoints.publicConfig),
  retry: false,
  retryOnMount: false,
  staleTime: 5 * 60_000,
});
