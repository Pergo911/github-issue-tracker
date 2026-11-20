import type { Hono } from "hono";
import {
  normaliseEmail,
  parseBulk,
  splitLines,
  type AllowlistEntry,
} from "@shared/allowlist/entries.ts";
import { endpoints } from "@shared/api/endpoints.ts";
import { registerEndpoint } from "../api/register.ts";
import {
  deleteEntry,
  listEntries,
  listedAddresses,
  readEntry,
  writeEntry,
} from "../allowlist/store.ts";

/**
 * Allowlist maintenance (SPEC 5), System admin only: `registerEndpoint` installs the role gate because each
 * endpoint declares `role: "admin"`. The note is free text that stays in KV: it is never sent to GitHub or in
 * an email.
 */
export function registerAllowlist(app: Hono<{ Bindings: Env }>): void {
  registerEndpoint(app, endpoints.allowlistList, async ({ env }) => ({
    entries: await listEntries(env.KV),
  }));

  registerEndpoint(app, endpoints.allowlistAdd, async ({ env, input, caller, fail }) => {
    const email = normaliseEmail(input.email);
    if (email === null) return fail("invalid_email");
    if ((await readEntry(env.KV, email)) !== null) return fail("already_listed");
    const entry: AllowlistEntry = {
      email,
      ...(input.note ? { note: input.note } : {}),
      addedBy: caller.login,
      addedAt: new Date().toISOString(),
    };
    await writeEntry(env.KV, entry);
    return { entry };
  });

  registerEndpoint(app, endpoints.allowlistNote, async ({ env, input, fail }) => {
    const email = normaliseEmail(input.email);
    const current = email === null ? null : await readEntry(env.KV, email);
    if (email === null || current === null) return fail("not_found");
    const { note: _old, ...rest } = current;
    const entry: AllowlistEntry = input.note === "" ? rest : { ...rest, note: input.note };
    await writeEntry(env.KV, entry);
    return { entry };
  });

  registerEndpoint(app, endpoints.allowlistRemove, async ({ env, input }) => {
    const email = normaliseEmail(input.email);
    if (email === null || (await readEntry(env.KV, email)) === null) return { removed: false };
    await deleteEntry(env.KV, email);
    return { removed: true };
  });

  registerEndpoint(app, endpoints.allowlistBulk, async ({ env, input, caller, fail }) => {
    const parsed = parseBulk(input.text);
    if (parsed.tooMany) return fail("too_many_entries");
    const listed = await listedAddresses(env.KV);
    const addedAt = new Date().toISOString();
    const errors = [...parsed.errors];
    const fresh = [];
    for (const entry of parsed.entries) {
      if (listed.has(entry.email)) {
        const text = splitLines(input.text)[entry.line - 1]?.trim() ?? entry.email;
        errors.push({ line: entry.line, text, code: "already_listed" });
      } else fresh.push(entry);
    }
    errors.sort((a, b) => a.line - b.line);
    const added: AllowlistEntry[] = fresh.map((entry) => ({
      email: entry.email,
      ...(entry.note ? { note: entry.note } : {}),
      addedBy: caller.login,
      addedAt,
    }));
    await Promise.all(added.map((entry) => writeEntry(env.KV, entry)));
    return { added, errors };
  });
}
