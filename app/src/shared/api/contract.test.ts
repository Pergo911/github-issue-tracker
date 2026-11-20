import { describe, expect, it } from "vitest";
import { z } from "zod";
import { en } from "../i18n/en.ts";
import { apiErrorBodySchema, COMMON_ERROR_STATUS, defineEndpoint, statusOf } from "./contract.ts";
import { ALL_ERROR_CODES, endpoints } from "./endpoints.ts";

describe("API contract", () => {
  it("declares the public configuration endpoint with its method, path and error codes", () => {
    expect(endpoints.publicConfig.method).toBe("GET");
    expect(endpoints.publicConfig.path).toBe("/api/config/public");
    expect(endpoints.publicConfig.errors).toEqual({ not_configured: 404 });
    expect(endpoints.publicConfig.request.safeParse({}).success).toBe(true);
  });

  it("keeps every endpoint under /api/, the only paths the Worker runs for (SPEC 2.6)", () => {
    for (const endpoint of Object.values(endpoints)) {
      expect(endpoint.path.startsWith("/api/"), endpoint.path).toBe(true);
    }
  });

  it("never declares two endpoints on the same method and path", () => {
    const keys = Object.values(endpoints).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every error code an HTTP error status", () => {
    for (const endpoint of Object.values(endpoints)) {
      for (const [code, status] of Object.entries(endpoint.errors)) {
        expect(status, code).toBeGreaterThanOrEqual(400);
        expect(status, code).toBeLessThan(600);
      }
    }
    for (const [code, status] of Object.entries(COMMON_ERROR_STATUS)) {
      expect(status, code).toBeGreaterThanOrEqual(400);
    }
  });

  it("gives every error code a message in the English catalog, so the SPA can localize it", () => {
    for (const code of ALL_ERROR_CODES) {
      expect(en, code).toHaveProperty([`api.error.${code}`]);
    }
  });

  it("resolves an error code to the status its endpoint declared", () => {
    expect(statusOf(endpoints.publicConfig, "not_configured")).toBe(404);
    expect(statusOf(endpoints.publicConfig, "rate_limited")).toBe(429);
    expect(statusOf(endpoints.publicConfig, "internal_error")).toBe(500);
  });

  it("describes the error body the Worker sends and the SPA reads", () => {
    expect(apiErrorBodySchema.parse({ error: { code: "not_configured" } })).toEqual({
      error: { code: "not_configured" },
    });
    expect(apiErrorBodySchema.safeParse({ error: "nope" }).success).toBe(false);
  });

  it("types the response and rejects undeclared error codes at compile time", () => {
    const echo = defineEndpoint({
      method: "POST",
      path: "/api/echo",
      request: z.object({ text: z.string() }),
      response: undefined as unknown as { text: string },
      errors: { too_long: 422 },
    });
    // @ts-expect-error "unknown_code" is not declared on this endpoint
    statusOf(echo, "unknown_code");
    expect(statusOf(echo, "too_long")).toBe(422);
  });
});
