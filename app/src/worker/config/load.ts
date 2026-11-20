import { configSchema, type Config } from "@shared/config/schema.ts";

/** The one KV key that holds the whole Deployment configuration (SPEC 5). */
export const CONFIG_KEY = "config";

/**
 * Reads and validates the configuration.
 * Returns `null` while the Deployment has no `config` key yet (SPEC 2.4: not configured), and throws when a
 * stored value is not valid JSON or breaks the schema: that is a broken Deployment, not an unconfigured one.
 */
export async function loadConfig(kv: KVNamespace): Promise<Config | null> {
  const stored = await kv.get(CONFIG_KEY, "json");
  if (stored === null) return null;
  return configSchema.parse(stored);
}
