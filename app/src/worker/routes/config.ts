import type { Hono } from "hono";
import { endpoints } from "@shared/api/endpoints.ts";
import { configSaveSchema, fieldErrorsOf } from "@shared/config/save.ts";
import { configSchema } from "@shared/config/schema.ts";
import { registerEndpoint } from "../api/register.ts";
import { CONFIG_KEY, loadConfig } from "../config/load.ts";
import { createBotClient } from "../github/bot-client.ts";
import { syncLabels } from "../github/label-sync.ts";

/**
 * The Admin-gated configuration endpoints (SPEC 2.4). Reading returns the whole configuration (the only place the
 * templates, sender fields and budget leave the Worker); saving validates it, syncs the repo's labels through the
 * Bot, and only then writes the `config` key with the last-editor block, so a configuration is never stored whose
 * labels could not be made. A first save on a fresh Deployment is the bootstrap.
 */
export function registerConfig(app: Hono<{ Bindings: Env }>): void {
  registerEndpoint(app, endpoints.configRead, async ({ env }) => ({
    config: await loadConfig(env.KV),
  }));

  registerEndpoint(app, endpoints.configSave, async ({ env, input, caller, fail }) => {
    const parsed = configSaveSchema.safeParse(input.config);
    if (!parsed.success) return fail("invalid_config", { fields: fieldErrorsOf(parsed.error) });

    let sync;
    try {
      sync = await syncLabels(createBotClient(env), parsed.data.taxonomy);
    } catch (error) {
      console.error("label sync failed", error);
      return fail("upstream_unavailable");
    }

    const config = configSchema.parse({
      ...parsed.data,
      lastEditor: { editedBy: caller.login, editedAt: new Date().toISOString() },
    });
    await env.KV.put(CONFIG_KEY, JSON.stringify(config));
    return { config, sync };
  });
}
