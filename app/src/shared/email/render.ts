import type { Config } from "../config/schema.ts";

/**
 * Renders one of the six plain-text emails (SPEC 4.6) from the Deployment's templates: the From header, the
 * subject, the body with its footer and `reply_to` when one is configured. Runtime-neutral and pure, so every
 * template shares one tested path. Never an `html` part.
 */

export type TemplateName = keyof Config["email"]["templates"];

export interface RenderedEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** Absent when the configuration has none (SPEC 4.6: never refuse to send). */
  replyTo?: string;
}

const SUBJECT_TITLE_LIMIT = 50;

/** A Report title as it appears in a subject: at most 50 characters, with an ellipsis when it was cut. */
export function truncateTitle(title: string): string {
  const characters = [...title];
  if (characters.length <= SUBJECT_TITLE_LIMIT) return title;
  return `${characters.slice(0, SUBJECT_TITLE_LIMIT - 1).join("")}…`;
}

/** One pass, so a value that looks like a placeholder is left as text. Unknown placeholders stay as they are. */
function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/** A display name is quoted (and escaped) when it contains a character that is special in an address. */
function displayName(name: string): string {
  return /[",<>@;:\\()[\]]/.test(name) ? `"${name.replace(/(["\\])/g, "\\$1")}"` : name;
}

/** The footer, with `{reply}` filled while reply-to is set and the clause (with its separator) dropped otherwise. */
function footer(email: Config["email"]): string {
  if (email.replyTo !== "") return fill(email.footer, { reply: email.replyClause }).trim();
  return email.footer.replace(/[\s—–,;:-]*\{reply\}/, "").trim();
}

export function renderEmail(options: {
  config: Config;
  /** The verified sending subdomain: `RESEND_FROM_DOMAIN`. */
  sendingDomain: string;
  template: TemplateName;
  to: string;
  params: Record<string, string | number>;
}): RenderedEmail {
  const { email } = options.config;
  const template = email.templates[options.template];
  const params = options.params;
  // The title in a subject is cut to 50 characters; the body carries it in full.
  const subjectParams =
    typeof params["title"] === "string"
      ? { ...params, title: truncateTitle(params["title"]) }
      : params;
  return {
    from: `${displayName(email.senderName)} <${email.senderLocalPart}@${options.sendingDomain}>`,
    to: options.to,
    subject: fill(template.subject, subjectParams),
    text: `${fill(template.body, params)}\n\n${footer(email)}`,
    ...(email.replyTo === "" ? {} : { replyTo: email.replyTo }),
  };
}
