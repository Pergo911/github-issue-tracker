import { renderEmail, type TemplateName } from "@shared/email/render.ts";
import type { Config } from "@shared/config/schema.ts";
import { sendMail } from "../resend/send-mail.ts";

/** Per-IP limits key on the connecting address; the local world lets a test pick its own client. */
export function clientKey(env: Env, request: Request): string {
  const local = env.LOCAL_WORLD ? request.headers.get("x-dev-client-ip") : null;
  return local ?? request.headers.get("cf-connecting-ip") ?? "unknown";
}

/** The Status link's base: the Deployment's `APP_URL`, or in the local world the origin the SPA is served from. */
export function appBase(env: Env, request: Request): string {
  const base = env.LOCAL_WORLD ? new URL(request.url).origin : env.APP_URL;
  return base.replace(/\/+$/, "");
}

/** Renders one of the six templates (SPEC 4.6) and sends it through Resend. Throws when the send fails. */
export async function sendTemplate(
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
