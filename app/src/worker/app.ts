import { Hono } from "hono";
import { installApiErrorHandling } from "./api/errors.ts";
import { registerLocalWorld } from "./dev/local-world.ts";
import { registerPublicConfig } from "./routes/public-config.ts";
import { registerRecovery } from "./routes/recovery.ts";
import { registerReports } from "./routes/reports.ts";
import { registerStaff } from "./routes/staff.ts";
import { registerStatus } from "./routes/status.ts";

/**
 * The Worker's Hono app. It only ever runs for /api/* (`run_worker_first` in wrangler.jsonc); everything
 * else is a static asset that never reaches it. Register each endpoint through `registerEndpoint`.
 */
export const app = new Hono<{ Bindings: Env }>();

installApiErrorHandling(app);
registerPublicConfig(app);
registerReports(app);
registerRecovery(app);
registerStatus(app);
registerStaff(app);
registerLocalWorld(app);
