import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  COMMON_ERROR_STATUS,
  type ApiErrorBody,
  type CommonErrorCode,
} from "@shared/api/endpoints.ts";

/** Failing from inside a handler: `fail("code")` throws this, and `registerEndpoint` answers with the code. */
export class ApiFailure extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** The error body every endpoint shares (`{ "error": { "code": "..." } }`), never carrying a message. */
export function errorResponse(code: string, status: number): Response {
  const body: ApiErrorBody = { error: { code } };
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function commonErrorResponse(code: CommonErrorCode): Response {
  return errorResponse(code, COMMON_ERROR_STATUS[code]);
}

/**
 * Makes everything under /api/ answer in the contract's error format: an unknown path or method is
 * `not_found`, a body Hono cannot parse is `invalid_request`, and anything unexpected is `internal_error`
 * with the detail logged and never sent.
 */
export function installApiErrorHandling(app: Hono<{ Bindings: Env }>): void {
  app.notFound(() => commonErrorResponse("not_found"));
  app.onError((error) => {
    if (error instanceof HTTPException && error.status === 400) {
      return commonErrorResponse("invalid_request");
    }
    console.error("unhandled error", error);
    return commonErrorResponse("internal_error");
  });
}
