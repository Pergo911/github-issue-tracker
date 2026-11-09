import { z } from "zod";
import type { AllowlistEntry, BulkLineError } from "../allowlist/entries.ts";
import { MAX_NOTE_LENGTH } from "../allowlist/entries.ts";
import type { PublicConfig } from "../config/public.ts";
import type { Config } from "../config/schema.ts";
import { FIELD_ERRORS } from "../reports/validate.ts";
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

/** Each field-validation failure travels as its own code with a 422, so the SPA can say which field. */
const fieldErrors = Object.fromEntries(FIELD_ERRORS.map((code) => [code, 422])) as {
  [K in (typeof FIELD_ERRORS)[number]]: 422;
};

const allowlistEmail = z.string().max(254);
const allowlistNote = z.string().trim().max(MAX_NOTE_LENGTH);

/** What a configuration save changed in the repo's labels (SPEC 2.4: the save is the sync). */
export interface LabelSync {
  created: string[];
  recoloured: string[];
}

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
    errors: { ...fieldErrors, not_configured: 404, invalid_code: 422, submission_pending: 503 },
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
  /** The caller's role, the repo and the expected Bot identity, for every Staff role (SPEC 2.4, 4.3). */
  staffMeta: defineEndpoint({
    method: "GET",
    path: "/api/staff/meta",
    request: z.object({}),
    response: type<StaffMeta>(),
    errors: {},
    role: "viewer",
  }),

  /** The Allowlist, newest first (SPEC 5). System admin only, like everything below. */
  allowlistList: defineEndpoint({
    method: "GET",
    path: "/api/staff/allowlist",
    request: z.object({}),
    response: type<{ entries: AllowlistEntry[] }>(),
    errors: {},
    role: "admin",
  }),
  allowlistAdd: defineEndpoint({
    method: "POST",
    path: "/api/staff/allowlist",
    request: z.object({ email: allowlistEmail, note: allowlistNote.optional() }),
    response: type<{ entry: AllowlistEntry }>(),
    errors: { invalid_email: 422, already_listed: 409 },
    role: "admin",
  }),
  /** Replaces the note of an entry; an empty note clears it. */
  allowlistNote: defineEndpoint({
    method: "PUT",
    path: "/api/staff/allowlist",
    request: z.object({ email: allowlistEmail, note: allowlistNote }),
    response: type<{ entry: AllowlistEntry }>(),
    errors: {},
    role: "admin",
  }),
  allowlistRemove: defineEndpoint({
    method: "DELETE",
    path: "/api/staff/allowlist",
    request: z.object({ email: allowlistEmail }),
    response: type<{ removed: boolean }>(),
    errors: {},
    role: "admin",
  }),
  /** A pasted list, one address per line with an optional note; the answer reports each refused line. */
  allowlistBulk: defineEndpoint({
    method: "POST",
    path: "/api/staff/allowlist/bulk",
    request: z.object({ text: z.string().max(200_000) }),
    response: type<{ added: AllowlistEntry[]; errors: BulkLineError[] }>(),
    errors: { too_many_entries: 422 },
    role: "admin",
  }),

  /** The full configuration, or `null` while the Deployment is not configured yet (SPEC 2.4). */
  configRead: defineEndpoint({
    method: "GET",
    path: "/api/staff/config",
    request: z.object({}),
    response: type<{ config: Config | null }>(),
    errors: {},
    role: "admin",
  }),
  /**
   * Saves the whole configuration and syncs the repo's labels. The body is validated by the handler against
   * `configSaveSchema`, so a refusal can name its fields (`invalid_config` carries them).
   */
  configSave: defineEndpoint({
    method: "PUT",
    path: "/api/staff/config",
    request: z.object({ config: z.unknown() }),
    response: type<{ config: Config; sync: LabelSync }>(),
    errors: { invalid_config: 422 },
    role: "admin",
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
