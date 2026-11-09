import type { AllowlistEntry } from "@shared/allowlist/entries.ts";

/**
 * The Allowlist in Workers KV (SPEC 5): `allowlist:<email>` holds `{note?, addedBy, addedAt}`. The same fields
 * ride along as KV metadata, so listing every entry costs one `list` call per thousand entries instead of a
 * `get` for each; a key without metadata (written by an older path) is read with a `get`.
 */
const PREFIX = "allowlist:";
/** KV metadata is limited to 1,024 bytes of JSON. */
const METADATA_LIMIT = 1000;

type Stored = Omit<AllowlistEntry, "email">;

export const allowlistKey = (email: string) => `${PREFIX}${email}`;

function asStored(value: unknown): Stored | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v["addedBy"] !== "string" || typeof v["addedAt"] !== "string") return null;
  return {
    addedBy: v["addedBy"],
    addedAt: v["addedAt"],
    ...(typeof v["note"] === "string" && v["note"] !== "" ? { note: v["note"] } : {}),
  };
}

export async function readEntry(kv: KVNamespace, email: string): Promise<AllowlistEntry | null> {
  const stored = asStored(await kv.get(allowlistKey(email), "json"));
  return stored === null ? null : { email, ...stored };
}

export async function writeEntry(kv: KVNamespace, entry: AllowlistEntry): Promise<void> {
  const { email, ...stored } = entry;
  const metadata = JSON.stringify(stored).length < METADATA_LIMIT ? stored : undefined;
  await kv.put(allowlistKey(email), JSON.stringify(stored), metadata ? { metadata } : {});
}

export async function deleteEntry(kv: KVNamespace, email: string): Promise<void> {
  await kv.delete(allowlistKey(email));
}

/** Every listed address, with its entry when the metadata carries it. */
async function listKeys(kv: KVNamespace): Promise<{ email: string; stored: Stored | null }[]> {
  const found: { email: string; stored: Stored | null }[] = [];
  let cursor: string | undefined;
  do {
    const page: KVNamespaceListResult<unknown> = await kv.list({
      prefix: PREFIX,
      ...(cursor ? { cursor } : {}),
    });
    for (const key of page.keys) {
      found.push({ email: key.name.slice(PREFIX.length), stored: asStored(key.metadata) });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return found;
}

/** The addresses on the list: one `list` call per thousand, no reads. */
export async function listedAddresses(kv: KVNamespace): Promise<Set<string>> {
  return new Set((await listKeys(kv)).map((key) => key.email));
}

/** Every entry, newest first. */
export async function listEntries(kv: KVNamespace): Promise<AllowlistEntry[]> {
  const keys = await listKeys(kv);
  const entries = await Promise.all(
    keys.map(async ({ email, stored }) => {
      if (stored) return { email, ...stored };
      return readEntry(kv, email);
    }),
  );
  return entries
    .filter((entry): entry is AllowlistEntry => entry !== null)
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.email.localeCompare(b.email));
}
