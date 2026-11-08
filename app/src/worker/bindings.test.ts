import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// The wrangler.jsonc bindings exist and work in the local Workers runtime. The gates are stubs for now
// (SPEC 4.5): tickets #23 and #24 replace them, keeping the class names, the bindings and the migration.
describe("bindings declared in wrangler.jsonc", () => {
  it("has a working KV namespace", async () => {
    await env.KV.put("bindings-test", "value");
    expect(await env.KV.get("bindings-test")).toBe("value");
    await env.KV.delete("bindings-test");
  });

  it("has the three SQLite-backed gates, each answering as a stub", async () => {
    for (const gate of [env.EMAIL_GATE, env.REPORT_GATE, env.GLOBAL_GATE]) {
      const response = await gate.getByName("bindings-test").fetch("https://gate.test/");
      expect(response.status).toBe(501);
      await response.arrayBuffer();
    }
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
