import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineEndpoint, endpoints, type } from "@shared/api/endpoints.ts";
import { ApiError, callApi } from "./call-api.ts";

const search = defineEndpoint({
  method: "GET",
  path: "/api/search",
  request: z.object({ q: z.string(), page: z.number().optional() }),
  response: type<{ hits: string[] }>(),
  errors: { too_broad: 422 },
});

const create = defineEndpoint({
  method: "POST",
  path: "/api/things",
  request: z.object({ name: z.string() }),
  response: type<{ id: number }>(),
  errors: {},
});

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const stub = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(input instanceof Request ? input.url : input.toString(), init ?? {})),
  );
  vi.stubGlobal("fetch", stub);
  return stub;
}

const jsonResponse = (body: unknown, status = 200) => Response.json(body, { status });

afterEach(() => vi.unstubAllGlobals());

describe("callApi", () => {
  it("calls an endpoint by its declared method and path, and returns the typed JSON", async () => {
    const stub = stubFetch(() => jsonResponse({ language: "hu" }));
    const result = await callApi(endpoints.publicConfig);
    expect(result).toEqual({ language: "hu" });
    expect(stub).toHaveBeenCalledTimes(1);
    const [url, init] = stub.mock.calls[0]!;
    expect(url).toBe("/api/config/public");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
  });

  it("sends a GET's input as a query string and skips undefined values", async () => {
    const stub = stubFetch(() => jsonResponse({ hits: [] }));
    await callApi(search, { q: "a b&c", page: undefined });
    expect(stub.mock.calls[0]![0]).toBe("/api/search?q=a+b%26c");
    await callApi(search, { q: "x", page: 2 });
    expect(stub.mock.calls[1]![0]).toBe("/api/search?q=x&page=2");
  });

  it("sends any other method's input as a JSON body", async () => {
    const stub = stubFetch(() => jsonResponse({ id: 7 }));
    expect(await callApi(create, { name: "Ő" })).toEqual({ id: 7 });
    const [url, init] = stub.mock.calls[0]!;
    expect(url).toBe("/api/things");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ name: "Ő" }));
  });

  it("turns an error response into an ApiError carrying the code and status", async () => {
    stubFetch(() => jsonResponse({ error: { code: "not_configured" } }, 404));
    await expect(callApi(endpoints.publicConfig)).rejects.toMatchObject({
      name: "ApiError",
      code: "not_configured",
      status: 404,
    });
    stubFetch(() => jsonResponse({ error: { code: "rate_limited" } }, 429));
    await expect(callApi(endpoints.publicConfig)).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
  });

  it("answers invalid_response when the error is not one this build knows, or not JSON at all", async () => {
    stubFetch(() => jsonResponse({ error: { code: "from_a_newer_build" } }, 409));
    await expect(callApi(endpoints.publicConfig)).rejects.toMatchObject({
      code: "invalid_response",
      status: 409,
    });

    stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(callApi(endpoints.publicConfig)).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
    });

    stubFetch(() => new Response("not json", { status: 200 }));
    await expect(callApi(endpoints.publicConfig)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("answers network_error when the request never completes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const failure = await callApi(endpoints.publicConfig).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: "network_error", status: 0 });
  });

  it("lets an abort through untouched, so the caller can tell cancellation from failure", async () => {
    const aborted = new DOMException("Aborted", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(aborted)),
    );
    await expect(callApi(endpoints.publicConfig)).rejects.toBe(aborted);
  });

  it("requires input at compile time exactly when the schema needs it", () => {
    stubFetch(() => jsonResponse({ hits: [] }));
    // @ts-expect-error q is required
    void callApi(search);
    // @ts-expect-error the key is q, not query
    void callApi(search, { query: "x" });
    void callApi(endpoints.publicConfig);
  });
});
