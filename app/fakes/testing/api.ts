import { GITHUB_ACCEPT, GITHUB_API_VERSION } from "@shared/github/constants.ts";
import type { World } from "../world.ts";

export interface Reply {
  status: number;
  headers: Headers;
  /** The parsed JSON body, or `undefined` when there is none. */
  json: any;
  text: string;
}

export interface CallOptions {
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** A JSON request body. */
  json?: unknown;
  /** A form-encoded request body (the device-flow endpoints). */
  form?: Record<string, string>;
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
  /** Leave out the `X-GitHub-Api-Version` header the fake insists on, to test that it does. */
  omitVersion?: boolean;
  omitUserAgent?: boolean;
}

/** The three base URLs of a world mounted at `origin`: what the Worker's variables hold in tests. */
export function worldUrls(origin: string) {
  return {
    githubApi: `${origin}/github`,
    githubWeb: `${origin}/github-web`,
    resendApi: `${origin}/resend`,
    control: `${origin}/control`,
  };
}

/**
 * A small HTTP client over a world's `handle`, used by the fakes' own tests: it speaks the real services' wire
 * format, so a test fails if the fake answers differently from what a client expects.
 */
export function httpClient(world: Pick<World, "handle">, origin = "https://world.test") {
  async function call(
    prefix: string,
    method: string,
    path: string,
    options: CallOptions = {},
  ): Promise<Reply> {
    const url = new URL(`${origin}${prefix}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const headers = new Headers(options.headers);
    if (!options.omitUserAgent) headers.set("user-agent", "fakes-test");
    if (options.token !== undefined) headers.set("authorization", `Bearer ${options.token}`);
    let body: string | undefined;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers.set("content-type", "application/json");
    } else if (options.form) {
      body = new URLSearchParams(options.form).toString();
      headers.set("content-type", "application/x-www-form-urlencoded");
    }
    const response = await world.handle(
      new Request(url, { method, headers, ...(body !== undefined ? { body } : {}) }),
    );
    const text = await response.text();
    let json: unknown;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, headers: response.headers, json, text };
  }

  return {
    /** api.github.com. Sends the API-version and Accept headers GitHub's clients must send. */
    github: (method: string, path: string, options: CallOptions = {}) =>
      call("/github", method, path, {
        ...options,
        headers: {
          accept: GITHUB_ACCEPT,
          ...(options.omitVersion ? {} : { "x-github-api-version": GITHUB_API_VERSION }),
          ...options.headers,
        },
      }),
    /** github.com's web endpoints (device flow). JSON answers need `accept: application/json`. */
    web: (method: string, path: string, options: CallOptions = {}) =>
      call("/github-web", method, path, {
        ...options,
        headers: { accept: "application/json", ...options.headers },
      }),
    resend: (method: string, path: string, options: CallOptions = {}) =>
      call("/resend", method, path, options),
  };
}

export type HttpClient = ReturnType<typeof httpClient>;
