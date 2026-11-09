import { z } from "zod";
import { LANGUAGES, configSchema } from "./schema.ts";

/**
 * What a System admin may save (SPEC 2.4): the whole configuration, except the last-editor block (the Worker
 * writes that) and with a strict language (the stored schema falls back to English, a save must not).
 */
export const configSaveSchema = configSchema
  .omit({ lastEditor: true })
  .extend({ language: z.enum(LANGUAGES) });

export type ConfigSave = z.output<typeof configSaveSchema>;

/** Why a field was refused. Each has an `config.error.<code>` message in the catalog. */
export const CONFIG_FIELD_ERROR_CODES = [
  "required",
  "too_long",
  "kebab",
  "colour",
  "timezone",
  "email",
  "duplicate",
  "label_length",
  "one_initial",
  "invalid_number",
  "invalid",
] as const;
export type ConfigFieldErrorCode = (typeof CONFIG_FIELD_ERROR_CODES)[number];

/** `path` is the field's place in the configuration, joined with dots: `taxonomy.category.2.id`. */
export interface ConfigFieldError {
  path: string;
  code: ConfigFieldErrorCode;
}

function codeOf(issue: z.core.$ZodIssue): ConfigFieldErrorCode {
  const field = issue.path.at(-1);
  switch (issue.code) {
    case "too_small":
      return issue.origin === "string" || issue.origin === "array" ? "required" : "invalid_number";
    case "too_big":
      return issue.origin === "string" ? "too_long" : "invalid";
    case "invalid_format":
      if (issue.format === "email") return "email";
      if (field === "color") return "colour";
      if (field === "id") return "kebab";
      return "invalid";
    case "custom":
      if (issue.message.startsWith("duplicate")) return "duplicate";
      if (issue.message.includes("longer than")) return "label_length";
      if (issue.message.includes("initial")) return "one_initial";
      if (field === "timezone") return "timezone";
      return "invalid";
    default:
      return field === "dailyCodeBudget" ? "invalid_number" : "invalid";
  }
}

/** The one place Zod's English stays out of the way: a path and a stable code, which the SPA words itself. */
export function fieldErrorsOf(error: z.ZodError): ConfigFieldError[] {
  const seen = new Set<string>();
  const errors: ConfigFieldError[] = [];
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    const code = codeOf(issue);
    const key = `${path}|${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    errors.push({ path, code });
  }
  return errors;
}
