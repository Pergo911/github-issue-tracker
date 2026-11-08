import type { Hono } from "hono";
import { z } from "zod";
import { defineEndpoint, type } from "@shared/api/contract.ts";
import type { StaffRole } from "@shared/github/roles.ts";
import type { GitHubIssue } from "@shared/github/types.ts";
import { commonErrorResponse } from "../api/errors.ts";
import { registerEndpoint } from "../api/register.ts";
import { createBotClient } from "../github/bot-client.ts";
import { sendMail } from "../resend/send-mail.ts";

/**
 * Smoke routes that exist only in the local world (`vite dev` sets `LOCAL_WORLD`, ticket #22): they prove
 * from a running dev server that the Worker reaches the fake GitHub as the Bot, resolves a Staff token to a
 * role, and sends mail through the fake Resend. A deployed Worker has no `LOCAL_WORLD`, so they answer 404.
 * They are not part of the API contract the SPA uses.
 */
const smoke = defineEndpoint({
  method: "POST",
  path: "/api/_dev/smoke",
  request: z.object({ to: z.string().min(3) }),
  response: type<{
    issueNumber: number;
    issueTitle: string;
    author: string;
    authorType: string;
    mailId: string;
  }>(),
  errors: {},
});

const whoami = defineEndpoint({
  method: "GET",
  path: "/api/_dev/whoami",
  request: z.object({}),
  response: type<{ role: StaffRole; login: string }>(),
  errors: {},
  role: "viewer",
});

export function registerLocalWorld(app: Hono<{ Bindings: Env }>): void {
  app.use("/api/_dev/*", async (c, next) => {
    if (!c.env.LOCAL_WORLD) return commonErrorResponse("not_found");
    await next();
    return undefined;
  });

  registerEndpoint(app, smoke, async ({ env, input }) => {
    const bot = createBotClient(env);
    const created = await bot.request<GitHubIssue>("POST", bot.repoPath("/issues"), {
      body: {
        title: "Local world smoke test",
        body: "Created by /api/_dev/smoke",
        labels: ["smoke"],
      },
    });
    const read = await bot.request<GitHubIssue>(
      "GET",
      bot.repoPath(`/issues/${created.data.number}`),
    );
    const mail = await sendMail(env, {
      from: `Local world <reports@${env.RESEND_FROM_DOMAIN}>`,
      to: input.to,
      subject: "Local world smoke test",
      text: `The Bot created issue #${read.data.number}.`,
    });
    return {
      issueNumber: read.data.number,
      issueTitle: read.data.title,
      author: read.data.user.login,
      authorType: read.data.user.type,
      mailId: mail.id,
    };
  });

  registerEndpoint(app, whoami, ({ caller }) => ({ role: caller.role, login: caller.login }));
}
