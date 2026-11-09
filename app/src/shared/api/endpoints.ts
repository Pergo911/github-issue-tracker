import { z } from "zod";
import type { PublicConfig } from "../config/public.ts";
import {
  REFERENCE_PATTERN,
  type RecoveryDetail,
  type RecoveryEntry,
  type ResumeResult,
} from "../reports/recovery.ts";
import { FIELD_ERRORS } from "../reports/validate.ts";
import type { StatusView } from "../status/view.ts";
import type { StaffDeviceCode, StaffDevicePoll, StaffMeta, StaffTokens } from "../staff/session.ts";
import {
  CLIENT_ERROR_CODES,
  COMMON_ERROR_STATUS,
  defineEndpoint,
  type,
  type ClientErrorCode,
  type CommonErrorCode,
} from "./contract.ts";

export * from "./contract.ts";

/** The OTP is six digits (SPEC 4.5). */
export const OTP_PATTERN = /^\d{6}$/;
/** The attempt credential: at least 128 random bits, base64url (SPEC 4.1). 16 bytes is 22 characters. */
export const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

/** An attempt is named by its address or by the reference the Reporter was given: exactly one of them. */
const attemptSelector = z
  .object({
    email: z.string().trim().pipe(z.email().max(254)).optional(),
    reference: z.string().regex(REFERENCE_PATTERN).optional(),
  })
  .refine((value) => (value.email === undefined) !== (value.reference === undefined), {
    message: "give an email or a reference, not both",
  });

/** Each field-validation failure travels as its own code with a 422, so the SPA can say which field. */
const fieldErrors = Object.fromEntries(FIELD_ERRORS.map((code) => [code, 422])) as {
  [K in (typeof FIELD_ERRORS)[number]]: 422;
};

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

  /**
   * Asks for a code (SPEC 4.1). The answer is the same for an unlisted address, a sent code, a cooldown and a
   * cap: only the Deployment-wide budget and the per-IP limit can say `rate_limited`.
   */
  requestCode: defineEndpoint({
    method: "POST",
    path: "/api/reports/code",
    request: z.object({ email: z.string().trim().pipe(z.email().max(254)) }),
    response: type<{ accepted: true }>(),
    errors: { not_configured: 404 },
  }),

  /**
   * Verifies the code and files the Report (SPEC 4.1). `submission_pending` means a verified attempt exists
   * whose issue is not confirmed yet: the Report is never created again automatically (ADR 0005).
   */
  submitReport: defineEndpoint({
    method: "POST",
    path: "/api/reports/submit",
    request: z.object({
      email: z.string().trim().pipe(z.email().max(254)),
      code: z.string().regex(OTP_PATTERN),
      credential: z.string().regex(CREDENTIAL_PATTERN),
      category: z.string().min(1).max(100),
      location: z.string().min(1).max(100),
      // Generous transport limits: the 3-80 / 4,000 / 100 limits are the validator's, with their own codes.
      title: z.string().max(2000),
      description: z.string().max(20_000),
      place: z.string().max(2000).optional(),
    }),
    response: type<{ number: number; title: string; statusUrl: string }>(),
    errors: {
      ...fieldErrors,
      not_configured: 404,
      invalid_code: 422,
      submission_pending: 503,
      // An earlier attempt for this address needs a person: its `reference` travels with the error.
      submission_unresolved: 503,
    },
  }),

  /**
   * Resumes a verified submission after an interruption (SPEC 4.1): gated by the attempt credential, 10 a minute
   * per address, and it reads and advances only that attempt. `not_found` for a credential that is unknown, spent
   * or whose link a Reissue replaced.
   */
  resumeSubmission: defineEndpoint({
    method: "POST",
    path: "/api/reports/resume",
    request: z.object({
      email: z.string().trim().pipe(z.email().max(254)),
      credential: z.string().regex(CREDENTIAL_PATTERN),
    }),
    response: type<ResumeResult>(),
    errors: { not_configured: 404 },
  }),

  /**
   * The Status page's read (SPEC 4.3): the public projection of the Report a Status link names. A token that is
   * unknown, malformed or replaced is the same generic `not_found`. The token travels in the body, not the path.
   */
  statusLookup: defineEndpoint({
    method: "POST",
    path: "/api/status/lookup",
    request: z.object({ token: z.string().max(200) }),
    response: type<StatusView>(),
    errors: { not_configured: 404 },
  }),

  /** A Reporter comment from the Status page (SPEC 4.3): 1-2,000 characters after trimming. */
  statusComment: defineEndpoint({
    method: "POST",
    path: "/api/status/comment",
    request: z.object({ token: z.string().max(200), text: z.string().max(20_000) }),
    response: type<{ accepted: true }>(),
    errors: { comment_length: 422, not_configured: 404 },
  }),

  /**
   * Ends this Status link for everyone and emails a new one to the Reporter (SPEC 4.3). The new link is never in
   * the answer. `reissue_mail_failed`: the link was replaced but the email could not be sent.
   */
  statusReissue: defineEndpoint({
    method: "POST",
    path: "/api/status/reissue",
    request: z.object({ token: z.string().max(200) }),
    response: type<{ sent: true }>(),
    errors: { reissue_mail_failed: 502, not_configured: 404 },
  }),

  /** Starts GitHub's device flow for the Staff app (SPEC 2.2): a proxy, so no `client_secret` exists anywhere. */
  staffDeviceCode: defineEndpoint({
    method: "POST",
    path: "/api/staff/device-code",
    request: z.object({}),
    response: type<StaffDeviceCode>(),
    errors: {},
  }),
  /** One poll of the device flow. */
  staffDeviceToken: defineEndpoint({
    method: "POST",
    path: "/api/staff/device-token",
    request: z.object({ deviceCode: z.string().min(1).max(200) }),
    response: type<StaffDevicePoll>(),
    errors: {},
  }),
  /** Exchanges a refresh token for a new token pair; a refresh token works once. */
  staffRefresh: defineEndpoint({
    method: "POST",
    path: "/api/staff/refresh",
    request: z.object({ refreshToken: z.string().min(1).max(200) }),
    response: type<StaffTokens>(),
    errors: { refresh_rejected: 401 },
  }),
  /** The retained submission attempts that need a person (SPEC 4.1): the operator procedure's list. */
  recoveryList: defineEndpoint({
    method: "GET",
    path: "/api/admin/recovery",
    request: z.object({}),
    response: type<{ attempts: RecoveryEntry[] }>(),
    errors: {},
    role: "admin",
  }),
  /** One retained attempt by reference or email, with a fresh look for its marker on GitHub. */
  recoveryInspect: defineEndpoint({
    method: "GET",
    path: "/api/admin/recovery/attempt",
    request: attemptSelector,
    response: type<RecoveryDetail>(),
    errors: { recovery_not_found: 404 },
    role: "admin",
  }),
  /** Associates a verified existing issue with the attempt, which finalizes its mappings. Never a new create. */
  recoveryAssociate: defineEndpoint({
    method: "POST",
    path: "/api/admin/recovery/associate",
    request: attemptSelector.safeExtend({ issueNumber: z.int().positive() }),
    response: type<{ outcome: "complete" | "saving"; number: number }>(),
    errors: { recovery_not_found: 404, issue_unverified: 422 },
    role: "admin",
  }),
  /** Discards the attempt and the partial mappings its issue may have gained. */
  recoveryDiscard: defineEndpoint({
    method: "POST",
    path: "/api/admin/recovery/discard",
    request: attemptSelector,
    response: type<{ discarded: true }>(),
    errors: { recovery_not_found: 404 },
    role: "admin",
  }),

  /** The caller's role, the repo and the expected Bot identity, for every Staff role (SPEC 2.4, 4.3). */
  staffMeta: defineEndpoint({
    method: "GET",
    path: "/api/staff/meta",
    request: z.object({}),
    response: type<StaffMeta>(),
    errors: {},
    role: "viewer",
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
