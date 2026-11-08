import { sValidator } from "@hono/standard-validator";
import type { Context, Hono, MiddlewareHandler } from "hono";
import {
  statusOf,
  type AnyEndpoint,
  type ParsedRequestOf,
  type ResponseOf,
  type WireErrorCodeOf,
} from "@shared/api/endpoints.ts";
import { requireRole, type StaffCaller } from "../auth/require-role.ts";
import { ApiFailure, commonErrorResponse, errorResponse } from "./errors.ts";

/** The caller of a gated endpoint (one that declares a `role`); a public endpoint has none. */
export type CallerOf<E extends AnyEndpoint> = [E["role"]] extends [undefined]
  ? undefined
  : StaffCaller;

export interface HandlerContext<E extends AnyEndpoint> {
  /** Who is calling, verified against the repo `permissions` by `requireRole`. Only gated endpoints have one. */
  caller: CallerOf<E>;
  /** The request, already validated against the endpoint's Zod schema. */
  input: ParsedRequestOf<E>;
  env: Env;
  request: Request;
  /** Ends the request with one of this endpoint's error codes (or a common one). */
  fail: (code: WireErrorCodeOf<E>) => never;
}

type App = Hono<{ Bindings: Env }>;

/**
 * The validating helper every handler goes through: it takes the contract's schema (so a handler can
 * never see unvalidated input), maps `fail(code)` to the declared HTTP status, and turns any other throw
 * into `internal_error` without leaking its message. Gate middleware (`requireRole`, per-IP limiting)
 * is added to the route here by the tickets that introduce it, so a gated endpoint cannot forget its gate.
 */
export function registerEndpoint<E extends AnyEndpoint>(
  app: App,
  endpoint: E,
  handler: (context: HandlerContext<E>) => ResponseOf<E> | Promise<ResponseOf<E>>,
): void {
  const target = endpoint.method === "GET" || endpoint.method === "DELETE" ? "query" : "json";

  const validate = sValidator(target, endpoint.request, (result) => {
    if (!result.success) return commonErrorResponse("invalid_request");
    return undefined;
  });

  // The gate comes first: an unauthenticated caller learns nothing, not even whether their body was valid.
  const gate = endpoint.role ? [requireRole(endpoint.role)] : [];

  const main = async (c: Context<{ Bindings: Env }>) => {
    const input = (c.req as unknown as { valid(target: string): unknown }).valid(target);
    try {
      const result = await handler({
        caller: (endpoint.role
          ? (c as unknown as Context<{ Variables: { caller: StaffCaller } }>).get("caller")
          : undefined) as CallerOf<E>,
        input: input as ParsedRequestOf<E>,
        env: c.env,
        request: c.req.raw,
        fail: (code) => {
          throw new ApiFailure(code);
        },
      });
      return Response.json(result, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof ApiFailure) {
        return errorResponse(error.code, statusOf(endpoint, error.code as WireErrorCodeOf<E>));
      }
      console.error("unhandled error in", endpoint.method, endpoint.path, error);
      return commonErrorResponse("internal_error");
    }
  };

  const handlers = [...gate, validate, main] as unknown as [
    MiddlewareHandler,
    ...MiddlewareHandler[],
  ];
  app.on(endpoint.method, endpoint.path, ...handlers);
}
