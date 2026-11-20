import type { AnyEndpoint, RequestOf, ResponseOf } from "@shared/api/endpoints.ts";
import { callApi } from "@/api/call-api.ts";
import { staffSession } from "../auth/session.ts";

/** Calls a role-gated endpoint as the signed-in member: the session adds the token and refreshes it on a 401. */
export function callAsStaff<E extends AnyEndpoint>(
  endpoint: E,
  input: RequestOf<E>,
): Promise<ResponseOf<E>> {
  return staffSession.withToken((token) =>
    (callApi as (e: E, i: RequestOf<E>, o: { token: string }) => Promise<ResponseOf<E>>)(
      endpoint,
      input,
      { token },
    ),
  );
}
