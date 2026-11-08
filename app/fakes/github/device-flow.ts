import type {
  DeviceCodeResponse,
  DeviceFlowError,
  DeviceTokenResponse,
} from "../../src/shared/github/types.ts";
import { DEVICE_CODE_GRANT } from "../../src/shared/github/constants.ts";
import type { Clock } from "../clock.ts";
import { REAL_WEB } from "./render.ts";
import {
  randomHex,
  REFRESH_TOKEN_TTL_MS,
  USER_TOKEN_TTL_MS,
  type TokenRegistry,
} from "./tokens.ts";

const CODE_LIFETIME_S = 900;
const INITIAL_INTERVAL_S = 5;

/** What a poll answers while a code is not approved; tests can force one with `scriptNextPoll`. */
export type ScriptedOutcome =
  "authorization_pending" | "slow_down" | "expired_token" | "access_denied";

type CodeStatus = "pending" | "approved" | "denied";

interface CodeRecord {
  deviceCode: string;
  userCode: string;
  clientId: string;
  expiresAt: number;
  interval: number;
  lastPollAt: number | null;
  status: CodeStatus;
  /** Who approved it: the token the next successful poll returns belongs to this login. */
  approvedFor: string | null;
  /** A token pair is returned once; polling again after success is an invalid code. */
  consumed: boolean;
}

export interface DeviceCodeInfo {
  userCode: string;
  deviceCode: string;
  status: "pending" | "approved" | "denied" | "expired";
  expiresAt: number;
}

/** A request parameter as text; anything but a string is empty (and so matches nothing). */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function userCode(): string {
  const letters = "BCDFGHJKLMNPQRSTVWXZ";
  const pick = () => letters[crypto.getRandomValues(new Uint8Array(1))[0]! % letters.length]!;
  return `${Array.from({ length: 4 }, pick).join("")}-${Array.from({ length: 4 }, pick).join("")}`;
}

/**
 * GitHub's web endpoints for device flow (SPEC 2.2): code, token and refresh. Errors are HTTP 200 with a JSON
 * `error` body, as GitHub sends them, and the answer is form-encoded unless the caller sent
 * `Accept: application/json` (the Worker's proxy must).
 */
export class DeviceFlow {
  readonly #clock: Clock;
  readonly #tokens: TokenRegistry;
  readonly #clientId: () => string;
  readonly #codes = new Map<string, CodeRecord>();
  #scripted: ScriptedOutcome | null = null;
  strictPolling = true;

  constructor(options: { clock: Clock; tokens: TokenRegistry; clientId: () => string }) {
    this.#clock = options.clock;
    this.#tokens = options.tokens;
    this.#clientId = options.clientId;
  }

  reset(): void {
    this.#codes.clear();
    this.#scripted = null;
    this.strictPolling = true;
  }

  // ---------------------------------------------------------------------------- the web endpoints

  requestCode(params: Record<string, unknown>): DeviceCodeResponse | DeviceFlowError {
    if (params["client_id"] !== this.#clientId()) {
      return {
        error: "incorrect_client_credentials",
        error_description: "The client_id and/or client_secret passed are incorrect.",
        error_uri:
          "https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/#incorrect-client-credentials",
      };
    }
    const now = this.#clock.now();
    const record: CodeRecord = {
      deviceCode: randomHex(40),
      userCode: userCode(),
      clientId: this.#clientId(),
      expiresAt: now + CODE_LIFETIME_S * 1000,
      interval: INITIAL_INTERVAL_S,
      lastPollAt: null,
      status: "pending",
      approvedFor: null,
      consumed: false,
    };
    this.#codes.set(record.deviceCode, record);
    return {
      device_code: record.deviceCode,
      user_code: record.userCode,
      // GitHub's page is github.com; the fake serves nothing there, tests approve through the control API.
      verification_uri: `${REAL_WEB}/login/device`,
      expires_in: CODE_LIFETIME_S,
      interval: record.interval,
    };
  }

  token(params: Record<string, unknown>): DeviceTokenResponse | DeviceFlowError {
    if (params["client_id"] !== this.#clientId()) {
      return {
        error: "incorrect_client_credentials",
        error_description: "The client_id and/or client_secret passed are incorrect.",
      };
    }
    const grant = params["grant_type"];
    if (grant === "refresh_token") return this.#refresh(params);
    if (grant !== DEVICE_CODE_GRANT) {
      return {
        error: "unsupported_grant_type",
        error_description: "The grant type must be urn:ietf:params:oauth:grant-type:device_code.",
      };
    }
    const record = this.#codes.get(text(params["device_code"]));
    if (!record || record.consumed) {
      return {
        error: "incorrect_device_code",
        error_description: "The device_code provided is not valid.",
      };
    }
    const now = this.#clock.now();
    const scripted = this.#scripted;
    this.#scripted = null;

    if (scripted === "expired_token" || (!scripted && now >= record.expiresAt)) {
      return { error: "expired_token", error_description: "The device_code has expired." };
    }
    if (scripted === "access_denied" || (!scripted && record.status === "denied")) {
      return { error: "access_denied", error_description: "The user has denied your application." };
    }
    const tooFast =
      this.strictPolling &&
      record.lastPollAt !== null &&
      now - record.lastPollAt < record.interval * 1000;
    record.lastPollAt = now;
    if (scripted === "slow_down" || (!scripted && tooFast)) {
      record.interval += 5;
      return {
        error: "slow_down",
        error_description: "Too many requests have been made in the same timeframe.",
        interval: record.interval,
      };
    }
    if (scripted === "authorization_pending" || (!scripted && record.status === "pending")) {
      return {
        error: "authorization_pending",
        error_description: "The authorization request is still pending.",
      };
    }
    record.consumed = true;
    const pair = this.#tokens.mintDeviceFlowPair(record.approvedFor as string);
    return {
      access_token: pair.accessToken,
      token_type: "bearer",
      scope: "",
      refresh_token: pair.refreshToken,
      expires_in: USER_TOKEN_TTL_MS / 1000,
      refresh_token_expires_in: REFRESH_TOKEN_TTL_MS / 1000,
    };
  }

  #refresh(params: Record<string, unknown>): DeviceTokenResponse | DeviceFlowError {
    const pair = this.#tokens.refresh(text(params["refresh_token"]));
    if (!pair) {
      return {
        error: "bad_refresh_token",
        error_description: "The refresh token passed is incorrect or expired.",
      };
    }
    return {
      access_token: pair.accessToken,
      token_type: "bearer",
      scope: "",
      refresh_token: pair.refreshToken,
      expires_in: USER_TOKEN_TTL_MS / 1000,
      refresh_token_expires_in: REFRESH_TOKEN_TTL_MS / 1000,
    };
  }

  // ------------------------------------------------------------------------ what tests script

  codes(): DeviceCodeInfo[] {
    const now = this.#clock.now();
    return [...this.#codes.values()]
      .filter((record) => !record.consumed)
      .map((record) => ({
        userCode: record.userCode,
        deviceCode: record.deviceCode,
        status: now >= record.expiresAt ? "expired" : record.status,
        expiresAt: record.expiresAt,
      }));
  }

  #byUserCode(code: string): CodeRecord {
    const normalised = code.trim().toUpperCase();
    for (const record of this.#codes.values()) {
      if (record.userCode === normalised) return record;
    }
    throw new Error(`No device code with user code ${code}`);
  }

  /** The user types the code at github.com/login/device and approves it as `login`. */
  approve(code: string, login: string): void {
    const record = this.#byUserCode(code);
    record.status = "approved";
    record.approvedFor = login;
  }

  deny(code: string): void {
    this.#byUserCode(code).status = "denied";
  }

  /** The 900 seconds are over for this code, without moving the whole clock. */
  expire(code: string): void {
    this.#byUserCode(code).expiresAt = this.#clock.now();
  }

  /** The next poll answers `outcome` whatever the code's state, once. */
  scriptNextPoll(outcome: ScriptedOutcome | null): void {
    this.#scripted = outcome;
  }
}
