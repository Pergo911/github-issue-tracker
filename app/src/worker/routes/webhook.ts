import type { Hono } from "hono";
import type { GitHubIssuesWebhookPayload } from "@shared/github/types.ts";
import { catalogFor, createTranslator } from "@shared/i18n/index.ts";
import { classifyIssuesEvent } from "@shared/webhook/major-change.ts";
import { loadConfig } from "../config/load.ts";
import { resolveBotIdentity } from "../github/bot-identity.ts";
import { evictView } from "../status/cache.ts";
import { hmacSha256Hex, constantTimeEqual } from "../util/crypto.ts";
import { appBase, sendTemplate } from "../util/request.ts";

/**
 * The GitHub webhook receiver (SPEC 3.2, 4.2): `POST /api/github/webhook`. It is not a JSON endpoint of the
 * API contract: the signature covers the raw body, which a validator would consume. It subscribes to `issues`
 * only; every other event is acknowledged and ignored. The work is a KV read or two and at most one Resend call,
 * done before answering so a delivery's outcome is visible to GitHub's delivery log, and so a test can wait for
 * it. GitHub does not retry: a failed send is logged and never replayed, and the status link remains the
 * authoritative history.
 */

/** `X-GitHub-Delivery` ids are remembered for about a day (SPEC 5). */
const SEEN_TTL_SECONDS = 24 * 60 * 60;

export function registerWebhook(app: Hono<{ Bindings: Env }>): void {
  app.post("/api/github/webhook", async (c) => {
    const env = c.env;
    const body = await c.req.text();

    const claimed = c.req.header("x-hub-signature-256") ?? "";
    const expected = `sha256=${await hmacSha256Hex(env.GITHUB_WEBHOOK_SECRET, body)}`;
    if (!constantTimeEqual(claimed, expected)) return c.json({ error: "bad_signature" }, 401);

    if (c.req.header("x-github-event") !== "issues") return c.body(null, 202);

    let payload: GitHubIssuesWebhookPayload;
    try {
      payload = JSON.parse(body) as GitHubIssuesWebhookPayload;
    } catch {
      return c.json({ error: "bad_payload" }, 400);
    }
    const number = payload.issue?.number;
    if (!Number.isInteger(number)) return c.json({ error: "bad_payload" }, 400);

    const config = await loadConfig(env.KV);
    if (config === null) {
      console.error("a webhook arrived before the Deployment was configured; dropped");
      return c.body(null, 202);
    }

    let classification;
    try {
      const bot = await resolveBotIdentity(env);
      classification = classifyIssuesEvent(payload, config.taxonomy, bot);
    } catch (error) {
      console.error("the webhook could not be classified; dropped", error);
      return c.json({ error: "internal_error" }, 500);
    }

    if (classification.kind === "erase") {
      const token = await env.KV.get(`issue-token:${number}`);
      if (token !== null) await evictView(token).catch(() => undefined);
      await env.REPORT_GATE.getByName(String(number)).tombstone(number);
      return c.body(null, 202);
    }
    if (classification.kind === "ignore") return c.body(null, 202);

    // A Major change: de-duplicate by delivery, writing the key only now (SPEC 4.2).
    const delivery = c.req.header("x-github-delivery") ?? "";
    if (delivery === "") return c.json({ error: "bad_payload" }, 400);
    const seen = `webhook-seen:${delivery}`;
    if ((await env.KV.get(seen)) !== null) return c.body(null, 202);
    await env.KV.put(seen, "true", { expirationTtl: SEEN_TTL_SECONDS });

    const [email, token] = await Promise.all([
      env.KV.get(`issue-email:${number}`),
      env.KV.get(`issue-token:${number}`),
    ]);
    if (email === null || token === null) {
      console.error(`Report #${number} has no Reporter mapping; its ${payload.action} is dropped`);
      return c.body(null, 202);
    }

    const t = createTranslator(catalogFor(config.language));
    const params: Record<string, string | number> = {
      number: number,
      title: payload.issue.title,
      link: `${appBase(env, c.req.raw)}/status/${token}`,
    };
    if (classification.template === "closed") {
      params["reason"] = t(`email.reason.${classification.params.reason}`);
    } else if (classification.template === "statusEntered") {
      params["status"] = classification.params.status;
    }
    try {
      await sendTemplate(env, config, classification.template, email, params);
    } catch (error) {
      console.error(`the ${classification.template} email for Report #${number} failed`, error);
    }
    // The page a Reporter opens next must not show the state from before the change.
    await evictView(token).catch(() => undefined);
    return c.body(null, 202);
  });
}
