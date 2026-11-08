import type { z } from "zod";
import { configSchema, type Config } from "./schema.ts";

/**
 * The public projection of the configuration (SPEC 2.4): what an unauthenticated visitor's SPA may see.
 *
 * It is an ALLOWLIST, defined once, here. A field added to `configSchema` later is private until someone
 * adds it to this list on purpose. The six template strings, the sender fields, the daily code budget
 * and the last-editor block are not on it, and never leave the Admin-gated endpoint.
 */
export const PUBLIC_CONFIG_FIELDS = [
  "language",
  "timezone",
  "displayName",
  "emergencyNotice",
  "codeSentHelp",
  "taxonomy",
] as const satisfies readonly (keyof Config)[];

/**
 * Builds a projection for any object schema and allowlist. Exported so a test can prove that a field added
 * to the schema stays out; the application uses only `toPublicConfig`.
 */
export function createProjection<S extends z.ZodObject, K extends keyof S["shape"] & string>(
  schema: S,
  fields: readonly K[],
): (value: z.output<S>) => Pick<z.output<S>, K> {
  for (const field of fields) {
    if (!(field in schema.shape)) {
      throw new Error(`"${field}" is on the allowlist but not in the schema`);
    }
  }
  return (value) => {
    const projected: Partial<Pick<z.output<S>, K>> = {};
    for (const field of fields) {
      projected[field] = value[field];
    }
    return projected as Pick<z.output<S>, K>;
  };
}

type PublicMask = { [K in (typeof PUBLIC_CONFIG_FIELDS)[number]]: true };
const publicMask = Object.fromEntries(PUBLIC_CONFIG_FIELDS.map((field) => [field, true])) as PublicMask;

/** The shape the public-configuration endpoint returns, and the SPA receives. */
export const publicConfigSchema = configSchema.pick(publicMask);
export type PublicConfig = z.output<typeof publicConfigSchema>;

export const toPublicConfig: (config: Config) => PublicConfig = createProjection(
  configSchema,
  PUBLIC_CONFIG_FIELDS,
);
