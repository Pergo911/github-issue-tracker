import type { StaffTokens } from "@shared/staff/session.ts";

/** The slice of `Storage` the store uses, so tests need no DOM. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since the epoch. */
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

const KEY = "staff.tokens";
/** Refresh this long before the access token really expires. */
const DUE_MARGIN_MS = 60_000;

/**
 * The one module that holds the Staff member's GitHub tokens (SPEC 2.2, 2.6): the 8-hour access token and the
 * refresh token, in `localStorage`, which Electron's default session also keeps across restarts. Storage that
 * is blocked or damaged means signed out, never a crash; the tokens are then held in memory for the page load.
 */
export function createTokenStore(storage: StorageLike, now: () => number = Date.now) {
  const listeners = new Set<() => void>();
  let current: StoredTokens | null | undefined;

  function load(): StoredTokens | null {
    try {
      const raw = storage.getItem(KEY);
      if (raw === null) return null;
      const value = JSON.parse(raw) as Partial<StoredTokens>;
      if (
        typeof value.accessToken === "string" &&
        typeof value.refreshToken === "string" &&
        typeof value.accessExpiresAt === "number" &&
        typeof value.refreshExpiresAt === "number"
      ) {
        return value as StoredTokens;
      }
    } catch {
      // Unreadable: signed out.
    }
    return null;
  }

  function set(next: StoredTokens | null): void {
    current = next;
    try {
      if (next) storage.setItem(KEY, JSON.stringify(next));
      else storage.removeItem(KEY);
    } catch {
      // Not persisted; the in-memory copy still works for this page load.
    }
    for (const listener of listeners) listener();
  }

  return {
    /** The same object until the tokens change. */
    read(): StoredTokens | null {
      current ??= load();
      return current;
    },
    save(tokens: StaffTokens): void {
      const at = now();
      set({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessExpiresAt: at + tokens.expiresIn * 1000,
        refreshExpiresAt: at + tokens.refreshTokenExpiresIn * 1000,
      });
    },
    clear(): void {
      set(null);
    },
    /** Expired, or about to be: refresh before using it. */
    accessTokenDue(): boolean {
      const tokens = this.read();
      return tokens !== null && tokens.accessExpiresAt - DUE_MARGIN_MS <= now();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type TokenStore = ReturnType<typeof createTokenStore>;

function browserStorage(): StorageLike {
  // Accessing `localStorage` itself can throw (blocked site data): defer it to each call.
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  };
}

/** The app's store, over the browser's `localStorage`. */
export const tokenStore: TokenStore = createTokenStore(browserStorage());
