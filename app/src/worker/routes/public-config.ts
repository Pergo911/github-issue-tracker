import type { Hono } from "hono";
import { endpoints } from "@shared/api/endpoints.ts";
import { toPublicConfig } from "@shared/config/public.ts";
import { registerEndpoint } from "../api/register.ts";
import { loadConfig } from "../config/load.ts";

/** The SPA's first request: the public projection of `config`, or the `not_configured` code (SPEC 2.4). */
export function registerPublicConfig(app: Hono<{ Bindings: Env }>): void {
  registerEndpoint(app, endpoints.publicConfig, async ({ env, fail }) => {
    const config = await loadConfig(env.KV);
    if (config === null) return fail("not_configured");
    return toPublicConfig(config);
  });
}
