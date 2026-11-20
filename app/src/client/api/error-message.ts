import type { Translator } from "@shared/i18n/index.ts";
import { ApiError } from "./call-api.ts";

/**
 * Errors travel as codes (SPEC 2.5); this is where the SPA turns one into words, in the configured language.
 * Anything that is not an `ApiError` (a bug, a thrown string) becomes the generic internal error, so a raw
 * code or an exception message never reaches a user.
 */
export function apiErrorMessage(t: Translator, error: unknown): string {
  return error instanceof ApiError ? t(`api.error.${error.code}`) : t("api.error.internal_error");
}
