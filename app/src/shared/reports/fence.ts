/**
 * The canonical dynamic code fence that neutralizes Reporter text inside a GitHub issue body (SPEC 4.3).
 * Runtime-neutral: the Worker writes with it, the SPA and the dashboard read with it.
 */

/** A zero-indented run of `max(3, longest backtick run in the text + 1)` backticks, with no info string. */
export function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

/** `F + "\n" + text + "\n" + F`: no backtick run in the text can close it. */
export function encodeFence(text: string): string {
  const fence = fenceFor(text);
  return `${fence}\n${text}\n${fence}`;
}

/**
 * The text of an exactly canonical envelope, or `null` for anything else (a Staff edit, a lookalike): the
 * caller then falls back to plain text. Accepts only when re-encoding the decoded text gives back `raw`.
 */
export function decodeFence(raw: string): string | null {
  const opening = /^`+/.exec(raw)?.[0].length ?? 0;
  if (opening < 3) return null;
  const inner = raw.slice(opening + 1, raw.length - opening - 1);
  if (raw[opening] !== "\n" || raw.length < 2 * opening + 2) return null;
  return encodeFence(inner) === raw ? inner : null;
}
