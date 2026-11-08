import { z } from "zod";

/**
 * The Deployment configuration: the whole `config` KV key (SPEC 2.4, 5).
 * Everything per-Deployment that is data lives here; deploy-time values and secrets live in wrangler.jsonc.
 * Which part of it the SPA may see is decided in `public.ts`, never here.
 */

/** The four fixed taxonomy dimensions (SPEC 2.3). A Deployment configures their values only. */
export const DIMENSIONS = ["category", "location", "priority", "status"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** The shipped UI languages (SPEC 2.5). Adding one is a code contribution. */
export const LANGUAGES = ["en", "hu"] as const;
export type Language = (typeof LANGUAGES)[number];

/** GitHub caps a label name at 50 characters. */
const MAX_LABEL_NAME_LENGTH = 50;

/** The GitHub label that carries a taxonomy value: `dimension:value`, lowercase English kebab-case. */
export function labelName(dimension: Dimension, id: string): string {
  return `${dimension}:${id}`;
}

const kebabCase = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase kebab-case");
const displayName = z.string().trim().min(1).max(100);
const hexColour = z.string().regex(/^[0-9a-f]{6}$/i, "six hex digits, no #");

const valueShape = { id: kebabCase, name: displayName, color: hexColour.optional() };

/** Category, Location and Priority values. Strict, so a Status flag on them is an error. */
const plainValue = z.strictObject(valueShape);

/** Status values: the only ones that may carry the `initial` and `notify` flags (SPEC 2.3). */
const statusValue = z.strictObject({
  ...valueShape,
  initial: z.boolean().default(false),
  notify: z.boolean().default(false),
});

function values<V extends z.ZodType<{ id: string }>>(dimension: Dimension, value: V) {
  return z
    .array(value)
    .min(1)
    .superRefine((list, ctx) => {
      const seen = new Set<string>();
      list.forEach((item, index) => {
        if (seen.has(item.id)) {
          ctx.addIssue({
            code: "custom",
            message: `duplicate ${dimension} value "${item.id}"`,
            path: [index, "id"],
          });
        }
        seen.add(item.id);
        if (labelName(dimension, item.id).length > MAX_LABEL_NAME_LENGTH) {
          ctx.addIssue({
            code: "custom",
            message: `"${labelName(dimension, item.id)}" is longer than ${MAX_LABEL_NAME_LENGTH} characters`,
            path: [index, "id"],
          });
        }
      });
    });
}

const statusValues = values("status", statusValue).refine(
  (list) => list.filter((status) => status.initial).length === 1,
  { message: "exactly one Status must have the initial flag" },
);

const taxonomySchema = z.strictObject({
  category: values("category", plainValue),
  location: values("location", plainValue),
  /** Ordered, lowest first. The order of the array is the order of the Priorities. */
  priority: values("priority", plainValue),
  status: statusValues,
});

function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const emailTemplate = z.strictObject({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
});

/** The six templates, and no others (SPEC 4.6). Each is authored in the Deployment's one language. */
const emailTemplates = z.strictObject({
  otp: emailTemplate,
  submissionConfirmation: emailTemplate,
  closed: emailTemplate,
  reopened: emailTemplate,
  statusEntered: emailTemplate,
  linkReissued: emailTemplate,
});

const emailSchema = z.strictObject({
  senderLocalPart: z.string().regex(/^[A-Za-z0-9._+-]{1,64}$/),
  senderName: displayName,
  /** Empty means the send goes out without reply_to (SPEC 4.6: fail safe, never refuse to send). */
  replyTo: z.union([z.literal(""), z.email()]),
  /** Fills the footer's `{reply}` placeholder while reply-to is set. */
  replyClause: z.string().trim().max(200),
  footer: z.string().trim().min(1).max(500),
  templates: emailTemplates,
});

export const configSchema = z.object({
  /** Unset or unknown falls back to English, as does a missing catalog key (SPEC 2.5). */
  language: z.enum(LANGUAGES).catch("en"),
  /** An IANA name. Unset means UTC. */
  timezone: z.string().refine(isTimeZone, "an IANA time zone name").default("UTC"),
  /** The Organization's name, shown in the header (SPEC 2.7). */
  displayName,
  emergencyNotice: z.string().trim().max(1000),
  /** The help text on the code-sent screen (SPEC 4.1). */
  codeSentHelp: z.string().trim().min(1).max(1000),
  taxonomy: taxonomySchema,
  email: emailSchema,
  dailyCodeBudget: z.int().positive().default(40),
  /** Who saved the configuration last (SPEC 2.4). Written by the Admin-gated save, not by the seed. */
  lastEditor: z.strictObject({ editedBy: z.string().min(1), editedAt: z.iso.datetime() }).optional(),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;
export type Taxonomy = Config["taxonomy"];
export type TaxonomyValue = Taxonomy["category"][number];
export type StatusValue = Taxonomy["status"][number];
