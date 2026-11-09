import type { Hono } from "hono";
import { endpoints } from "@shared/api/endpoints.ts";
import { labelName } from "@shared/config/schema.ts";
import { catalogFor, createTranslator } from "@shared/i18n/index.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import { buildReportBody } from "@shared/reports/body.ts";
import { normalizeEmail, validateFields } from "@shared/reports/validate.ts";
import { registerEndpoint } from "../api/register.ts";
import { loadConfig } from "../config/load.ts";
import { OTP_TTL_MS, type CompletionReceipt, type RecoverView } from "../gates/email-gate.ts";
import { reach } from "../gates/probe.ts";
import { createBotClient } from "../github/bot-client.ts";
import { injectedCreateFailures } from "../dev/local-world.ts";
import { randomToken, sha256Hex } from "../util/crypto.ts";
import { appBase, clientKey, sendTemplate } from "../util/request.ts";

/**
 * The Submission form's two endpoints (SPEC 4.1): request a code, and verify the code and file the Report.
 * The Reporter's email goes to the gates, KV and Resend, and never into a GitHub write.
 */

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

/**
 * The receipt's Status token, only while it is still the Report's current one: a Reissue or an Erasure voids
 * the receipt, so it never reveals a token that was replaced (SPEC 4.1).
 */
async function currentToken(env: Env, receipt: CompletionReceipt): Promise<string | null> {
  const view = await env.REPORT_GATE.getByName(String(receipt.issueNumber)).view();
  if (!view || view.state === "deleted" || view.generation !== receipt.generation) return null;
  return receipt.statusToken;
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
        return outcome.unresolved
          ? fail("submission_unresolved", outcome.reference)
          : fail("submission_pending");
      case "replay": {
        const token = await currentToken(env, outcome.receipt);
        if (token === null) return fail("not_found");
        return {
          number: outcome.receipt.issueNumber,
          title: outcome.receipt.title,
          statusUrl: statusUrl(token),
        };
      }
      case "verified":
        break;
    }

    // Past the dispatch fence the create is never repeated: a failure makes it uncertain, and recovery settles it
    // by finding the marker (ADR 0005).
    let issueNumber: number;
    try {
      const t = createTranslator(catalogFor(config.language));
      const category = config.taxonomy.category.find((value) => value.id === fields.category);
      const location = config.taxonomy.location.find((value) => value.id === fields.location);
      const initial = config.taxonomy.status.find((status) => status.initial);
      const bot = createBotClient(env);
      // The local world can fail one address's create before it reaches GitHub (end-to-end recovery journeys).
      if (env.LOCAL_WORLD && injectedCreateFailures.delete(email)) {
        throw new Error("an injected create failure (local world)");
      }
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
      reach("after-create");
    } catch (error) {
      console.error("the create is uncertain; recovery will look for its marker", error);
      await gate.markUncertain(credentialHash).catch(() => undefined);
      return fail("submission_pending");
    }

    // The issue number is persisted at once, then the Report gate registers and finalizes the mappings.
    let finished: RecoverView;
    try {
      await gate.recordIssue(credentialHash, issueNumber);
      finished = await gate.recover(Date.now());
    } catch (error) {
      console.error("a created Report is not finalized yet; recovery repairs it", error);
      return fail("submission_pending");
    }
    if (finished.kind !== "complete") return fail("submission_pending");

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

  registerEndpoint(app, endpoints.resumeSubmission, async ({ env, input, request, fail }) => {
    const config = await loadConfig(env.KV);
    if (config === null) return fail("not_configured");
    if (!(await env.RL_RESUME_IP.limit({ key: clientKey(env, request) })).success) {
      return fail("rate_limited");
    }

    const email = normalizeEmail(input.email);
    const credentialHash = await sha256Hex(`credential:${input.credential}`);
    const gate = env.EMAIL_GATE.getByName(await sha256Hex(email));
    // Only the attempt of this credential is read, and only it is advanced.
    const view = await gate.resume(credentialHash, Date.now());
    switch (view.kind) {
      case "none":
        return fail("not_found");
      case "saving":
        return { status: "saving" } as const;
      case "needs_help":
        return { status: "needs_help", reference: view.reference } as const;
      case "complete": {
        const token = await currentToken(env, view.receipt);
        if (token === null) return fail("not_found");
        const link = `${appBase(env, request)}/status/${token}`;
        if (view.completedNow) {
          // This pass finished the Report the first request could not: the Reporter still gets the email.
          try {
            await sendTemplate(env, config, "submissionConfirmation", email, {
              number: view.receipt.issueNumber,
              title: view.receipt.title,
              link,
            });
          } catch (error) {
            console.error("the confirmation email could not be sent", error);
          }
        }
        return {
          status: "complete",
          number: view.receipt.issueNumber,
          title: view.receipt.title,
          statusUrl: link,
        } as const;
      }
    }
  });
}
