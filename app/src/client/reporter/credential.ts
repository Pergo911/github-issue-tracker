/**
 * The submission-attempt credential (SPEC 4.1): 256 random bits, base64url, created before the first dispatch
 * and kept in `sessionStorage`, so a lost response can be recovered in the same tab (ticket #24). It is a
 * temporary bearer secret for one attempt: it authorizes nothing else.
 */
export const CREDENTIAL_STORAGE_KEY = "report-attempt-credential";

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

/** The attempt is over (the Report was filed): the next one gets a new credential. */
export function forgetCredential(storage: StorageLike | null = sessionStore()): void {
  try {
    storage?.removeItem(CREDENTIAL_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}
