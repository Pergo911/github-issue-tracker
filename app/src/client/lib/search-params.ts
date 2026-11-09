import type { z } from "zod";

/**
 * The small Zod helper behind the dashboard's URL search params (SPEC 2.6): the first value of each key goes
 * through the schema. Write the schema with `.catch(default)` on every field, so a hand-edited or stale URL
 * falls back to the default instead of failing.
 */
export function parseSearchParams<S extends z.ZodType>(
  schema: S,
  params: URLSearchParams,
): z.output<S> {
  const values: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!(key in values)) values[key] = value;
  }
  return schema.parse(values);
}
