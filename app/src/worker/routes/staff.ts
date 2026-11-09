import type { Hono } from "hono";
import { endpoints } from "@shared/api/endpoints.ts";
import { DEVICE_CODE_GRANT, WORKER_USER_AGENT } from "@shared/github/constants.ts";
import type {
  DeviceCodeResponse,
  DeviceFlowError,
  DeviceTokenResponse,
} from "@shared/github/types.ts";
import type { StaffDevicePoll, StaffTokens } from "@shared/staff/session.ts";
import { registerEndpoint } from "../api/register.ts";
import { resolveBotIdentity } from "../github/bot-identity.ts";

/**
 * The Staff sign-in (SPEC 2.2): a thin proxy to GitHub's device-flow endpoints. GitHub's browser-facing
 * endpoints send no CORS headers, which is the only reason it exists. The Staff app is a GitHub App using device
 * flow, so there is no `client_secret`: just the client id, a Worker variable.
 */
async function githubWeb<T>(
  env: Pick<Env, "GITHUB_WEB_BASE">,
  path: string,
  form: Record<string, string>,
): Promise<T | null> {
  try {
    const response = await fetch(`${env.GITHUB_WEB_BASE.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": WORKER_USER_AGENT,
      },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return await response.json<T>();
  } catch {
    return null;
  }
}

function tokensOf(answer: DeviceTokenResponse): StaffTokens | null {
  if (!answer.refresh_token) return null;
  return {
    accessToken: answer.access_token,
    refreshToken: answer.refresh_token,
    expiresIn: answer.expires_in ?? 28_800,
    refreshTokenExpiresIn: answer.refresh_token_expires_in ?? 15_897_600,
  };
}

export function registerStaff(app: Hono<{ Bindings: Env }>): void {
  registerEndpoint(app, endpoints.staffDeviceCode, async ({ env, fail }) => {
    const answer = await githubWeb<DeviceCodeResponse | DeviceFlowError>(
      env,
      "/login/device/code",
      { client_id: env.STAFF_APP_CLIENT_ID },
    );
    if (!answer || "error" in answer) return fail("upstream_unavailable");
    return {
      deviceCode: answer.device_code,
      userCode: answer.user_code,
      verificationUri: answer.verification_uri,
      expiresIn: answer.expires_in,
      interval: answer.interval,
    };
  });

  registerEndpoint(
    app,
    endpoints.staffDeviceToken,
    async ({ env, input, fail }): Promise<StaffDevicePoll> => {
      const answer = await githubWeb<DeviceTokenResponse | DeviceFlowError>(
        env,
        "/login/oauth/access_token",
        {
          client_id: env.STAFF_APP_CLIENT_ID,
          device_code: input.deviceCode,
          grant_type: DEVICE_CODE_GRANT,
        },
      );
      if (!answer) return fail("upstream_unavailable");
      if ("error" in answer) {
        switch (answer.error) {
          case "authorization_pending":
            return { status: "pending" };
          case "slow_down":
            return { status: "slow_down", interval: answer.interval ?? 10 };
          // An unknown or already used code is as good as expired: the member starts again.
          case "expired_token":
          case "incorrect_device_code":
            return { status: "expired" };
          case "access_denied":
            return { status: "denied" };
          default:
            return fail("upstream_unavailable");
        }
      }
      const tokens = tokensOf(answer);
      if (!tokens) return fail("upstream_unavailable");
      return { status: "authorized", ...tokens };
    },
  );

  registerEndpoint(app, endpoints.staffRefresh, async ({ env, input, fail }) => {
    const answer = await githubWeb<DeviceTokenResponse | DeviceFlowError>(
      env,
      "/login/oauth/access_token",
      {
        client_id: env.STAFF_APP_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
      },
    );
    if (!answer) return fail("upstream_unavailable");
    if ("error" in answer) {
      return fail(
        answer.error === "bad_refresh_token" ? "refresh_rejected" : "upstream_unavailable",
      );
    }
    const tokens = tokensOf(answer);
    return tokens ?? fail("upstream_unavailable");
  });

  registerEndpoint(app, endpoints.staffMeta, async ({ env, caller, fail }) => {
    let bot;
    try {
      bot = await resolveBotIdentity(env);
    } catch {
      return fail("upstream_unavailable");
    }
    return {
      role: caller.role,
      login: caller.login,
      repo: { owner: env.GITHUB_ORG, name: env.GITHUB_REPO },
      bot,
    };
  });
}
