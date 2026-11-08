import { describe, expect, it } from "vitest";
import { ALL_ERROR_CODES } from "@shared/api/endpoints.ts";
import { createTranslator, en, hu } from "@shared/i18n/index.ts";
import { ApiError } from "./call-api.ts";
import { apiErrorMessage } from "./error-message.ts";

describe("apiErrorMessage", () => {
  const english = createTranslator(en);
  const hungarian = createTranslator(hu);

  it("localizes an ApiError's code through the catalog", () => {
    expect(apiErrorMessage(hungarian, new ApiError("not_configured", 404))).toBe(
      hu["api.error.not_configured"],
    );
    expect(apiErrorMessage(english, new ApiError("rate_limited", 429))).toBe(
      en["api.error.rate_limited"],
    );
  });

  it("has a message in both languages for every code any endpoint can fail with", () => {
    for (const code of ALL_ERROR_CODES) {
      const error = new ApiError(code, 0);
      expect(apiErrorMessage(english, error), code).toBe(en[`api.error.${code}`]);
      expect(apiErrorMessage(hungarian, error), code).toBe(hu[`api.error.${code}`]);
    }
  });

  it("answers with the generic internal error for anything that is not an ApiError", () => {
    expect(apiErrorMessage(english, new Error("boom"))).toBe(en["api.error.internal_error"]);
    expect(apiErrorMessage(english, "boom")).toBe(en["api.error.internal_error"]);
    expect(apiErrorMessage(english, undefined)).toBe(en["api.error.internal_error"]);
  });

  it("never shows the raw code or an exception message to a user", () => {
    const shown = apiErrorMessage(english, new ApiError("not_configured", 404));
    expect(shown).not.toContain("not_configured");
    expect(apiErrorMessage(english, new Error("secret detail"))).not.toContain("secret detail");
  });
});
