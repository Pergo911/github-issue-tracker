import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiErrorBodySchema } from "@shared/api/endpoints.ts";
import { toPublicConfig } from "@shared/config/public.ts";
import { configSchema } from "@shared/config/schema.ts";
import { referenceConfig } from "@shared/seed/reference-config.ts";

const url = "https://reports.test/api/config/public";

afterEach(async () => {
  vi.restoreAllMocks();
  await env.KV.delete("config");
});

describe("GET /api/config/public", () => {
  it("answers the not_configured code while the Deployment has no config key", async () => {
    const response = await exports.default.fetch(url);
    expect(response.status).toBe(404);
    expect(apiErrorBodySchema.parse(await response.json())).toEqual({
      error: { code: "not_configured" },
    });
  });

  it("returns the public projection of the stored configuration, and only that", async () => {
    await env.KV.put("config", JSON.stringify(referenceConfig));
    const response = await exports.default.fetch(url);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual(toPublicConfig(configSchema.parse(referenceConfig)));
    for (const privateText of [
      "templates",
      "senderLocalPart",
      "dailyCodeBudget",
      "gondnok@example.org",
    ]) {
      expect(text).not.toContain(privateText);
    }
  });

  it("is never cached, because the configuration can change under it", async () => {
    await env.KV.put("config", JSON.stringify(referenceConfig));
    const response = await exports.default.fetch(url);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await response.arrayBuffer();
  });

  it("answers internal_error, not not_configured, for a stored config that is not valid", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const stored of ["{not json", JSON.stringify({ language: "hu" })]) {
      await env.KV.put("config", stored);
      const response = await exports.default.fetch(url);
      expect(response.status, stored).toBe(500);
      expect(await response.json()).toEqual({ error: { code: "internal_error" } });
    }
  });

  it("answers not_found as JSON for any other /api/ path or method", async () => {
    const unknown = await exports.default.fetch("https://reports.test/api/nothing");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: { code: "not_found" } });

    const wrongMethod = await exports.default.fetch(url, { method: "POST" });
    expect(wrongMethod.status).toBe(404);
    await wrongMethod.arrayBuffer();
  });
});
