import type { Clock } from "../clock.ts";

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function randomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function randomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

export interface TokenRecord {
  /** A Staff user-to-server token (`ghu_`), or the Bot's installation token (`ghs_`). */
  kind: "user" | "installation";
  login: string;
  /** Milliseconds on the world clock, or `null` for a token that never expires. */
  expiresAt: number | null;
}

interface RefreshRecord {
  login: string;
  expiresAt: number;
  accessToken: string;
}

export const USER_TOKEN_TTL_MS = 8 * 3_600_000;
export const REFRESH_TOKEN_TTL_MS = 15_897_600_000;
export const INSTALLATION_TOKEN_TTL_MS = 3_600_000;

/**
 * Every credential the fake GitHub has handed out. Expiry follows the world clock, so a test ages a token
 * with `advanceClock`. Refresh tokens are single use, as on GitHub: refreshing kills the old pair.
 */
export class TokenRegistry {
  readonly #clock: Clock;
  readonly #tokens = new Map<string, TokenRecord>();
  readonly #refreshTokens = new Map<string, RefreshRecord>();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** A static token that never expires: what Worker tests hand straight to `Authorization`. */
  mintStatic(login: string): string {
    const token = `ghu_${randomString(36)}`;
    this.#tokens.set(token, { kind: "user", login, expiresAt: null });
    return token;
  }

  /** The 8-hour access token and the refresh token a device-flow approval returns. */
  mintDeviceFlowPair(login: string) {
    const accessToken = `ghu_${randomString(36)}`;
    const refreshToken = `ghr_${randomString(36)}`;
    const now = this.#clock.now();
    this.#tokens.set(accessToken, { kind: "user", login, expiresAt: now + USER_TOKEN_TTL_MS });
    this.#refreshTokens.set(refreshToken, {
      login,
      expiresAt: now + REFRESH_TOKEN_TTL_MS,
      accessToken,
    });
    return { accessToken, refreshToken };
  }

  mintInstallation(login: string) {
    const token = `ghs_${randomString(36)}`;
    const expiresAt = this.#clock.now() + INSTALLATION_TOKEN_TTL_MS;
    this.#tokens.set(token, { kind: "installation", login, expiresAt });
    return { token, expiresAt };
  }

  /** The record behind a token, `"expired"` for one that has aged out, `undefined` for one never issued. */
  lookup(token: string): TokenRecord | "expired" | undefined {
    const record = this.#tokens.get(token);
    if (!record) return undefined;
    if (record.expiresAt !== null && record.expiresAt <= this.#clock.now()) return "expired";
    return record;
  }

  /** Exchanges a refresh token for a new pair and kills the old pair. `undefined` when it is not valid. */
  refresh(refreshToken: string) {
    const record = this.#refreshTokens.get(refreshToken);
    if (!record || record.expiresAt <= this.#clock.now()) return undefined;
    this.#refreshTokens.delete(refreshToken);
    this.#tokens.delete(record.accessToken);
    return this.mintDeviceFlowPair(record.login);
  }

  clear(): void {
    this.#tokens.clear();
    this.#refreshTokens.clear();
  }
}
