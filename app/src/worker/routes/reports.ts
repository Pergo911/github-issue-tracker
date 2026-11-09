import type { Hono } from "hono";
import { endpoints } from "@shared/api/endpoints.ts";
import { labelName, type Config } from "@shared/config/schema.ts";
import { renderEmail, type TemplateName } from "@shared/email/render.ts";
import { catalogFor, createTranslator } from "@shared/i18n/index.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import { buildReportBody } from "@shared/reports/body.ts";
import { normalizeEmail, validateFields } from "@shared/reports/validate.ts";
import { registerEndpoint } from "../api/register.ts";
import { loadConfig } from "../config/load.ts";
import { OTP_TTL_MS } from "../gates/email-gate.ts";
import { createBotClient } from "../github/bot-client.ts";
import { sendMail } from "../resend/send-mail.ts";
import { randomToken, sha256Hex } from "../util/crypto.ts";

/**
 * The Submission form's two endpoints (SPEC 4.1): request a code, and verify the code and file the Report.
 * The Reporter's email goes to the gates, KV and Resend, and never into a GitHub write.
 */

/** Per-IP limits key on the connecting address; the local world lets a test pick its own client. */
function clientKey(env: Env, request: Request): string {
  const local = env.LOCAL_WORLD ? request.headers.get("x-dev-client-ip") : null;
  return local ?? request.headers.get("cf-connecting-ip") ?? "unknown";
}

/** The Status link's base: the Deployment's `APP_URL`, or in the local world the origin the SPA is served from. */
function appBase(env: Env, request: Request): string {
  const base = env.LOCAL_WORLD ? new URL(request.url).origin : env.APP_URL;
  return base.replace(/\/+$/, "");
}

async function sendTemplate(
  env: Env,
  config: Config,
  template: TemplateName,
  to: string,
  params: Record<string, string | number>,
): Promise<void> {
  const mail = renderEmail({ config, sendingDomain: env.RESEND_FROM_DOMAIN, template, to, params });
  await sendMail(env, {
    from: mail.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
  });
}

/** Canonical JSON of the validated payload, in a fixed key order, hashed: replays must match it exactly. */
function fingerprintOf(email: string, fields: Record<string, string | undefined>): Promise<string> {
  return sha256Hex(
    JSON.stringify([
      email,
      fields["category"],
      fields["location"],
      fields["title"],
      fields["description"],
      fields["place"] ?? null,
    ]),
  );
}

export function registerReports(app: Hono<{ Bindings: Env }>): void {
  registerEndpoint(app, endpoints.requestCode, async ({ env, input, request, waitUntil, fail }) => {
    const config = await loadConfig(env.KV);
    if (config === null) return fail("not_configured");

    // 1. The Deployment-wide budget, awaited on every request first: its 429 never depends on membership,
    //    and no per-email state has been touched yet.
    const now = Date.now();
    if (!(await env.GLOBAL_GATE.getByName("deployment").take(config.dailyCodeBudget, now))) {
      return fail("rate_limited");
    }
    // 2. The per-IP burst.
    if (!(await env.RL_OTP_REQUEST_IP.limit({ key: clientKey(env, request) })).success) {
      return fail("rate_limited");
    }
    // 3. The Allowlist read. Only a listed address does any per-email work, and that runs after the response.
    const email = normalizeEmail(input.email);
    if ((await env.KV.get(`allowlist:${email}`)) !== null) {
      waitUntil(
        (async () => {
          const gate = env.EMAIL_GATE.getByName(await sha256Hex(email));
          const code = await gate.issueCode(Date.now());
          if (code === null) return; // cooling down or capped: silent
          await sendTemplate(env, config, "otp", email, {
            code,
            minutes: OTP_TTL_MS / 60_000,
          });
        })(),
      );
    }
    return { accepted: true } as const;
  });

  registerEndpoint(app, endpoints.submitReport, async ({ env, input, request, fail }) => {
    const config = await loadConfig(env.KV);
    if (config === null) return fail("not_configured");

    // Validate before the code is consumed (SPEC 4.1).
    const validation = validateFields(input, {
      categories: config.taxonomy.category.map((value) => value.id),
      locations: config.taxonomy.location.map((value) => value.id),
    });
    if (!validation.ok) return fail(validation.error);
    const { fields } = validation;

    if (!(await env.RL_VERIFY_IP.limit({ key: clientKey(env, request) })).success) {
      return fail("rate_limited");
    }

    const email = normalizeEmail(input.email);
    const credentialHash = await sha256Hex(`credential:${input.credential}`);
    const statusToken = randomToken(16);
    const marker = randomToken(16);
    const gate = env.EMAIL_GATE.getByName(await sha256Hex(email));
    const statusUrl = (token: string) => `${appBase(env, request)}/status/${token}`;

    // The gate counts the guess, consumes the code and persists the attempt and its dispatch fence together.
    const outcome = await gate.verifyAndSubmit({
      code: input.code,
      credentialHash,
      fingerprint: await fingerprintOf(email, fields as unknown as Record<string, string>),
      email,
      fields,
      marker,
      statusToken,
      now: Date.now(),
    });
    switch (outcome.kind) {
      case "invalid_code":
        return fail("invalid_code");
      case "conflict":
        return fail("invalid_request");
      case "pending":
        return fail("submission_pending");
      case "replay":
        return {
          number: outcome.receipt.issueNumber,
          title: outcome.receipt.title,
          statusUrl: statusUrl(outcome.receipt.statusToken),
        };
      case "verified":
        break;
    }

    // Past the dispatch fence nothing here is ever repeated: a failure leaves the attempt pending for ticket #24.
    let issueNumber: number;
    try {
      const t = createTranslator(catalogFor(config.language));
      const category = config.taxonomy.category.find((value) => value.id === fields.category);
      const location = config.taxonomy.location.find((value) => value.id === fields.location);
      const initial = config.taxonomy.status.find((status) => status.initial);
      const bot = createBotClient(env);
      const created = await bot.request<GitHubIssue>("POST", bot.repoPath("/issues"), {
        body: {
          title: fields.title,
          body: buildReportBody({
            t,
            categoryName: category?.name ?? fields.category,
            locationName: location?.name ?? fields.location,
            place: fields.place,
            description: fields.description,
            marker,
          }),
          labels: [
            labelName("category", fields.category),
            labelName("location", fields.location),
            ...(initial ? [labelName("status", initial.id)] : []),
          ],
        },
      });
      issueNumber = created.data.number;
      await gate.recordIssue(credentialHash, issueNumber);
      await env.REPORT_GATE.getByName(String(issueNumber)).writeMappings({
        issueNumber,
        email,
        statusToken,
      });
      await gate.complete(credentialHash, Date.now());
    } catch (error) {
      console.error("a verified submission is left pending", error);
      return fail("submission_pending");
    }

    // Best effort: a failed confirmation is logged and never undoes completion.
    try {
      await sendTemplate(env, config, "submissionConfirmation", email, {
        number: issueNumber,
        title: fields.title,
        link: statusUrl(statusToken),
      });
    } catch (error) {
      console.error("the confirmation email could not be sent", error);
    }
    return { number: issueNumber, title: fields.title, statusUrl: statusUrl(statusToken) };
  });
}
