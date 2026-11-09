import {
  apiErrorBodySchema,
  isApiErrorCode,
  type AnyEndpoint,
  type ApiErrorCode,
  type RequestOf,
  type ResponseOf,
} from "@shared/api/endpoints.ts";

/** An error code the SPA localizes with `api.error.<code>`. `status` is 0 when no response arrived. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  constructor(code: ApiErrorCode, status: number) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface CallOptions {
  signal?: AbortSignal;
  /** A Staff member's GitHub token, for an endpoint that declares a `role`. */
  token?: string;
}

/** The input is optional exactly when an empty object satisfies the schema. */
type CallArguments<E extends AnyEndpoint> =
  Record<never, never> extends RequestOf<E>
    ? [input?: RequestOf<E>, options?: CallOptions]
    : [input: RequestOf<E>, options?: CallOptions];

function queryString(input: Record<string, unknown>): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      parameters.append(key, String(item));
    }
  }
  const text = parameters.toString();
  return text === "" ? "" : `?${text}`;
}

/**
 * The SPA's one way to call the Worker: typed by the endpoint's contract, and failing only with
 * an `ApiError` (or an abort, passed through untouched so a caller can tell cancellation from failure).
 */
export async function callApi<E extends AnyEndpoint>(
  endpoint: E,
  ...[input, options]: CallArguments<E>
): Promise<ResponseOf<E>> {
  const headers = new Headers({ accept: "application/json" });
  const init: RequestInit = { method: endpoint.method, headers };
  if (options?.signal) init.signal = options.signal;
  if (options?.token) headers.set("authorization", `Bearer ${options.token}`);
  let url: string = endpoint.path;
  if (endpoint.method === "GET" || endpoint.method === "DELETE") {
    if (input) url += queryString(input);
  } else {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(input ?? {});
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("network_error", 0);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("invalid_response", response.status);
  }

  if (response.ok) return body;

  const failure = apiErrorBodySchema.safeParse(body);
  if (failure.success && isApiErrorCode(failure.data.error.code)) {
    throw new ApiError(failure.data.error.code, response.status);
  }
  throw new ApiError("invalid_response", response.status);
}
