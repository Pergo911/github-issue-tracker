import { z } from "zod";

/**
 * Allowlist entries (SPEC 5): the address is trimmed and lowercased and nothing more (no dot or `+tag` folding,
 * so matching is exact), checked for syntax and deduplicated. The `note` is free text, shown only to a System
 * admin, and never leaves the Deployment's KV.
 */

export const MAX_NOTE_LENGTH = 200;
export const MAX_BULK_LINES = 500;
const MAX_EMAIL_LENGTH = 254;

const emailSyntax = z.email().max(MAX_EMAIL_LENGTH);

/** The normalised address, or `null` when the text is not an email address. */
export function normaliseEmail(text: string): string | null {
  const email = text.trim().toLowerCase();
  return emailSyntax.safeParse(email).success ? email : null;
}

/** What `allowlist:<email>` holds, plus the address (its key). */
export interface AllowlistEntry {
  email: string;
  note?: string;
  addedBy: string;
  addedAt: string;
}

/** `already_listed` is added by the Worker, which alone can see what is on the list. */
export type BulkLineErrorCode = "invalid_email" | "duplicate" | "note_too_long" | "already_listed";

export interface BulkLineError {
  /** 1-based, counting blank lines too, so it matches what the admin pasted. */
  line: number;
  text: string;
  code: BulkLineErrorCode;
}

export interface ParsedBulk {
  /** `line` is where the address was pasted (1-based). */
  entries: { email: string; note?: string; line: number }[];
  errors: BulkLineError[];
  /** More than 500 non-blank lines: nothing is parsed further. */
  tooMany: boolean;
}

/** The lines of pasted text, whatever line ending the paste carried. */
export const splitLines = (text: string): string[] => text.split(/\r\n|\r|\n/);

/** One line: the address is up to the first space, tab, comma or semicolon; the rest is the note. */
export function parseBulk(text: string): ParsedBulk {
  const lines = text.split(/\r\n|\r|\n/);
  const filled = lines.filter((line) => line.trim() !== "").length;
  if (filled > MAX_BULK_LINES) return { entries: [], errors: [], tooMany: true };

  const entries: ParsedBulk["entries"] = [];
  const errors: BulkLineError[] = [];
  const seen = new Set<string>();
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;
    const fail = (code: BulkLineErrorCode) => errors.push({ line: index + 1, text: line, code });
    const split = /^([^\s,;]+)[\s,;]*(.*)$/s.exec(line);
    const email = normaliseEmail(split?.[1] ?? "");
    if (email === null) return fail("invalid_email");
    const note = (split?.[2] ?? "").trim();
    if ([...note].length > MAX_NOTE_LENGTH) return fail("note_too_long");
    if (seen.has(email)) return fail("duplicate");
    seen.add(email);
    entries.push(note === "" ? { email, line: index + 1 } : { email, note, line: index + 1 });
  });
  return { entries, errors, tooMany: false };
}
