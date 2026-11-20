import { signTestJwt } from "./jwt.ts";
import type { TestWorld } from "./world.ts";

/** Exchanges a freshly signed App JWT for the Bot's installation token, the way the Worker's client does. */
export async function installationToken(test: TestWorld): Promise<string> {
  const jwt = await signTestJwt(test.keys.privateKeyPkcs8, { iss: String(test.bot.appId) });
  const reply = await test.client.github(
    "POST",
    `/app/installations/${test.bot.installationId}/access_tokens`,
    { token: jwt },
  );
  if (reply.status !== 201) throw new Error(`installation token exchange failed: ${reply.text}`);
  return reply.json.token as string;
}

/** A world with one Staff user per role and the Bot's token: the cast most tests need. */
export async function castedWorld(test: TestWorld) {
  const { control } = test;
  return {
    bot: await installationToken(test),
    admin: control.addStaff({ login: "adam-admin", role: "admin" }).token,
    triage: control.addStaff({ login: "tamas-triage", role: "triage" }).token,
    read: control.addStaff({ login: "vera-viewer", role: "read" }).token,
    outsider: control.addStaff({ login: "nora-outsider", role: "none" }).token,
    path: (suffix = "") => `/repos/${test.org}/${test.repo}${suffix}`,
  };
}
