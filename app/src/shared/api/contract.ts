import { z } from "zod";

/**
 * Contract-first API (SPEC 2.6). Each endpoint declares its method, path, a Zod request schema,
 * its response type and its error codes. The Worker registers handlers against these declarations
 * (`worker/api/register.ts`) and the SPA calls them through `callApi` (`client/api/call-api.ts`),
 * so neither side can drift. Responses are typed, not parsed at runtime: the SPA and the Worker
 * deploy as one build. Errors travel as stable codes; the SPA localizes them (`api.error.<code>`).
 *
 * The request schema describes the query string for GET and DELETE and the JSON body for the rest.
 * Path parameters are not part of the contract: keep an identifier in the query or the body, or extend
 * `defineEndpoint`, `registerEndpoint` and `callApi` together, with a test.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Codes any endpoint can answer with, and the HTTP status each travels with. */
export const COMMON_ERROR_STATUS = {
  invalid_request: 400,
  not_found: 404,
  rate_limited: 429,
  internal_error: 500,
} as const;
export type CommonErrorCode = keyof typeof COMMON_ERROR_STATUS;

/** Codes only the SPA produces: the request never completed, or the answer was not ours. */
export const CLIENT_ERROR_CODES = ["network_error", "invalid_response"] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

export interface Endpoint<
  M extends HttpMethod = HttpMethod,
  P extends `/api/${string}` = `/api/${string}`,
  Req extends z.ZodType = z.ZodType,
  Res = unknown,
  Errors extends Record<string, number> = Record<string, number>,
> {
  readonly method: M;
  readonly path: P;
  readonly request: Req;
  /** Phantom: only its type is used. Write `response: type<MyResponse>()`. */
  readonly response: Res;
  /** The endpoint's own error codes and the HTTP status each travels with. */
  readonly errors: Errors;
}

export type AnyEndpoint = Endpoint<
  HttpMethod,
  `/api/${string}`,
  z.ZodType,
  unknown,
  Record<string, number>
>;

export function defineEndpoint<
  const M extends HttpMethod,
  const P extends `/api/${string}`,
  Req extends z.ZodType,
  Res,
  const Errors extends Record<string, number>,
>(endpoint: Endpoint<M, P, Req, Res, Errors>): Endpoint<M, P, Req, Res, Errors> {
  return endpoint;
}

/** A type-only value for an endpoint's `response`. */
export function type<T>(): T {
  return undefined as unknown as T;
}

export type RequestOf<E extends AnyEndpoint> = z.input<E["request"]>;
export type ParsedRequestOf<E extends AnyEndpoint> = z.output<E["request"]>;
export type ResponseOf<E extends AnyEndpoint> = E["response"];
/** Every code the endpoint can fail with, as the SPA sees it. */
export type ErrorCodeOf<E extends AnyEndpoint> =
  (keyof E["errors"] & string) | CommonErrorCode | ClientErrorCode;
/** The codes the Worker may send for this endpoint (not the client-only ones). */
export type WireErrorCodeOf<E extends AnyEndpoint> = (keyof E["errors"] & string) | CommonErrorCode;

export function statusOf<E extends AnyEndpoint>(endpoint: E, code: WireErrorCodeOf<E>): number {
  const own: Record<string, number> = endpoint.errors;
  const common: Record<string, number> = COMMON_ERROR_STATUS;
  return own[code] ?? common[code] ?? 500;
}

/** The body of every error response: `{ "error": { "code": "..." } }`. */
export const apiErrorBodySchema = z.object({ error: z.object({ code: z.string().min(1) }) });
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
