import type { StaffRole } from "../github/roles.ts";

/** What the Worker's Staff sign-in endpoints answer (SPEC 2.2): GitHub's snake_case, as camelCase. */

/** A started device flow: show `userCode`, send the member to `verificationUri`, poll for `deviceCode`. */
export interface StaffDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds until the code expires (900). */
  expiresIn: number;
  /** Seconds between polls. */
  interval: number;
}

/** The 8-hour access token and the refresh token; both lifetimes in seconds. */
export interface StaffTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshTokenExpiresIn: number;
}

/** One poll of the device flow. GitHub's errors are all HTTP 200; here each outcome is a status. */
export type StaffDevicePoll =
  | ({ status: "authorized" } & StaffTokens)
  | { status: "pending" }
  /** Poll no faster than `interval` seconds from now on. */
  | { status: "slow_down"; interval: number }
  | { status: "expired" }
  | { status: "denied" };

/** What every Staff role may learn about the Deployment (SPEC 4.3: the expected Bot identity). */
export interface StaffMeta {
  role: StaffRole;
  login: string;
  /** Where the Reports live: the SPA's calls to GitHub need it, and it is never on a public endpoint. */
  repo: { owner: string; name: string };
  /** The Bot that opens Reports and posts Reporter comments (attribution needs login, id and `Bot`). */
  bot: { login: string; id: number; type: "Bot" };
}
