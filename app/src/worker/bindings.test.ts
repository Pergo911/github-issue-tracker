import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// The wrangler.jsonc bindings exist and work in the local Workers runtime. The gates themselves are tested in
// their own files (SPEC 4.5).
describe("bindings declared in wrangler.jsonc", () => {
  it("has a working KV namespace", async () => {
    await env.KV.put("bindings-test", "value");
    expect(await env.KV.get("bindings-test")).toBe("value");
    await env.KV.delete("bindings-test");
  });

  it("has the three SQLite-backed gates, reachable by name", async () => {
    expect(await env.GLOBAL_GATE.getByName("bindings-test").take(1)).toBe(true);
    expect(await env.EMAIL_GATE.getByName("bindings-test").issueCode()).toMatch(/^\d{6}$/);
    // A Report gate nobody registered has no lifecycle yet.
    expect(await env.REPORT_GATE.getByName("bindings-test").view()).toBeNull();
  });

  it("has every Rate Limiting binding SPEC 4.5 needs", async () => {
    const limiters = {
      RL_OTP_REQUEST_IP: env.RL_OTP_REQUEST_IP,
      RL_VERIFY_IP: env.RL_VERIFY_IP,
      RL_RESUME_IP: env.RL_RESUME_IP,
      RL_STATUS_IP: env.RL_STATUS_IP,
      RL_STATUS_TOKEN: env.RL_STATUS_TOKEN,
      RL_COMMENT_IP: env.RL_COMMENT_IP,
      RL_COMMENT_TOKEN: env.RL_COMMENT_TOKEN,
    };
    for (const [name, limiter] of Object.entries(limiters)) {
      const outcome = await limiter.limit({ key: `bindings-test-${name}` });
      expect(outcome.success, name).toBe(true);
    }
  });

  it("limits a key once its allowance is spent", async () => {
    // RL_COMMENT_TOKEN allows 3 per 60 seconds (SPEC 4.5).
    const outcomes: boolean[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      outcomes.push((await env.RL_COMMENT_TOKEN.limit({ key: "burst-test" })).success);
    }
    expect(outcomes.filter(Boolean).length).toBeLessThanOrEqual(3);
    expect(outcomes.at(-1)).toBe(false);
  });

  it("knows the deploy-time values SPEC 2.6 lists as vars", () => {
    for (const name of ["GITHUB_ORG", "GITHUB_REPO", "RESEND_FROM_DOMAIN", "APP_URL"] as const) {
      expect(env[name], name).toBeTypeOf("string");
    }
  });
});
