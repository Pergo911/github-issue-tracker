/**
 * The submission-attempt credential (SPEC 4.1): 256 random bits, base64url, created before the first dispatch
 * and kept in `sessionStorage`, so a lost response can be recovered in the same tab (SPEC 4.1). It is a
 * temporary bearer secret for one attempt: it authorizes nothing else.
 */
export const CREDENTIAL_STORAGE_KEY = "report-attempt-credential";
/** Set when the final submit was dispatched and its outcome is not known: the tab resumes it after a refresh. */
export const PENDING_STORAGE_KEY = "report-attempt-pending";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function randomCredential(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sessionStore(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The tab's credential, created and stored first if there is none. Works (unrecoverably) without storage. */
export function attemptCredential(storage: StorageLike | null = sessionStore()): string {
  try {
    const existing = storage?.getItem(CREDENTIAL_STORAGE_KEY);
    if (existing) return existing;
  } catch {
    // storage blocked: fall through to a fresh one
  }
  const fresh = randomCredential();
  try {
    storage?.setItem(CREDENTIAL_STORAGE_KEY, fresh);
  } catch {
    // nothing to keep it in: the attempt works, it just cannot be resumed after a refresh
  }
  return fresh;
}

/** The submit is on its way: remember the address the credential belongs to, so a refresh can resume it. */
export function rememberPending(email: string, storage: StorageLike | null = sessionStore()): void {
  try {
    storage?.setItem(PENDING_STORAGE_KEY, JSON.stringify({ email }));
  } catch {
    // nothing to keep it in: the attempt works, it just cannot be resumed after a refresh
  }
}

/** The tab's unfinished submission, if its outcome was never learned: what to resume after a refresh. */
export function pendingSubmission(
  storage: StorageLike | null = sessionStore(),
): { email: string; credential: string } | null {
  try {
    const credential = storage?.getItem(CREDENTIAL_STORAGE_KEY);
    const raw = storage?.getItem(PENDING_STORAGE_KEY);
    if (!credential || !raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const email = (parsed as { email?: unknown } | null)?.email;
    return typeof email === "string" && email !== "" ? { email, credential } : null;
  } catch {
    return null;
  }
}

/** The attempt is over (the Report was filed, or it was refused): the next one gets a new credential. */
export function forgetCredential(storage: StorageLike | null = sessionStore()): void {
  try {
    storage?.removeItem(CREDENTIAL_STORAGE_KEY);
    storage?.removeItem(PENDING_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}

/** The submit was refused before it could create anything: keep the credential, drop the pending marker. */
export function clearPending(storage: StorageLike | null = sessionStore()): void {
  try {
    storage?.removeItem(PENDING_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}
