import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  COMMON_ERROR_STATUS,
  type ApiErrorBody,
  type CommonErrorCode,
} from "@shared/api/endpoints.ts";

/** What an error answer may carry beyond its code: a submission's `reference`, or a refused save's `fields`. */
export interface ErrorDetail {
  reference?: string;
  fields?: { path: string; code: string }[];
}

/** Failing from inside a handler: `fail("code")` throws this, and `registerEndpoint` answers with the code. */
export class ApiFailure extends Error {
  readonly code: string;
  readonly reference: string | undefined;
  readonly fields: { path: string; code: string }[] | undefined;
  constructor(code: string, detail: ErrorDetail = {}) {
    super(code);
    this.code = code;
    this.reference = detail.reference;
    this.fields = detail.fields;
  }
}

/** The error body every endpoint shares (`{ "error": { "code": "..." } }`), never carrying a message. */
export function errorResponse(code: string, status: number, detail: ErrorDetail = {}): Response {
  const body: ApiErrorBody = {
    error: {
      code,
      ...(detail.reference ? { reference: detail.reference } : {}),
      ...(detail.fields ? { fields: detail.fields } : {}),
    },
  };
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
