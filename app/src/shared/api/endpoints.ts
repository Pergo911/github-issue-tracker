import { z } from "zod";
import type { PublicConfig } from "../config/public.ts";
import {
  CLIENT_ERROR_CODES,
  COMMON_ERROR_STATUS,
  defineEndpoint,
  type,
  type ClientErrorCode,
  type CommonErrorCode,
} from "./contract.ts";

export * from "./contract.ts";

/**
 * Every endpoint of the Worker. Add yours here; the Worker registers a handler for it and the SPA
 * calls it by this object, never by a hand-typed path.
 */
export const endpoints = {
  /** The unauthenticated public projection of the configuration (SPEC 2.4). The SPA's first request. */
  publicConfig: defineEndpoint({
    method: "GET",
    path: "/api/config/public",
    request: z.object({}),
    response: type<PublicConfig>(),
    errors: { not_configured: 404 },
  }),
};

type DeclaredErrorCode = {
  [K in keyof typeof endpoints]: keyof (typeof endpoints)[K]["errors"] & string;
}[keyof typeof endpoints];

/** Every error code any endpoint can answer with. Each needs an `api.error.<code>` catalog message. */
export type ApiErrorCode = DeclaredErrorCode | CommonErrorCode | ClientErrorCode;

export const ALL_ERROR_CODES: readonly ApiErrorCode[] = [
  ...new Set<ApiErrorCode>([
    ...Object.values(endpoints).flatMap(
      (endpoint) => Object.keys(endpoint.errors) as ApiErrorCode[],
    ),
    ...(Object.keys(COMMON_ERROR_STATUS) as CommonErrorCode[]),
    ...CLIENT_ERROR_CODES,
  ]),
];

export function isApiErrorCode(code: string): code is ApiErrorCode {
  return (ALL_ERROR_CODES as readonly string[]).includes(code);
}
