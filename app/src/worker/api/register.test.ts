import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineEndpoint, type } from "@shared/api/endpoints.ts";
import { installApiErrorHandling } from "./errors.ts";
import { registerEndpoint } from "./register.ts";

const greet = defineEndpoint({
  method: "GET",
  path: "/api/greet",
  request: z.object({ name: z.string().min(1) }),
  response: type<{ greeting: string }>(),
  errors: { name_taken: 409 },
});

const echo = defineEndpoint({
  method: "POST",
  path: "/api/echo",
  request: z.object({ text: z.string().max(5) }),
  response: type<{ text: string }>(),
  errors: { too_shouty: 422 },
});

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  installApiErrorHandling(app);
  const handled = vi.fn();
  registerEndpoint(app, greet, ({ input, fail }) => {
    handled(input);
    if (input.name === "Taken") fail("name_taken");
    if (input.name === "Limited") fail("rate_limited");
    if (input.name === "Boom") throw new Error("secret detail that must not leak");
    return { greeting: `Hello ${input.name}` };
  });
  registerEndpoint(app, echo, ({ input }) => ({ text: input.text }));
  return { app, handled };
}

async function json(response: Response) {
  return (await response.json()) as unknown;
}

describe("registerEndpoint", () => {
  afterEach(() => vi.restoreAllMocks());

  it("validates a GET's query string and hands the parsed input to the handler", async () => {
    const { app, handled } = buildApp();
    const response = await app.request("/api/greet?name=Anna");
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ greeting: "Hello Anna" });
    expect(handled).toHaveBeenCalledWith({ name: "Anna" });
  });

  it("validates a POST's JSON body", async () => {
    const { app } = buildApp();
    const response = await app.request("/api/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ text: "hello" });
  });

  it("answers invalid_request, without calling the handler or echoing the input", async () => {
    const { app, handled } = buildApp();
    const missing = await app.request("/api/greet");
    expect(missing.status).toBe(400);
    expect(await json(missing)).toEqual({ error: { code: "invalid_request" } });

    const tooLong = await app.request("/api/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "far too long" }),
    });
    expect(tooLong.status).toBe(400);
    expect(JSON.stringify(await json(tooLong))).not.toContain("far too long");
    expect(handled).not.toHaveBeenCalled();
  });

  it("answers invalid_request for a body that is not JSON", async () => {
    const { app } = buildApp();
    const response = await app.request("/api/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: { code: "invalid_request" } });
  });

  it("turns fail(code) into the status the endpoint declared", async () => {
    const { app } = buildApp();
    const taken = await app.request("/api/greet?name=Taken");
    expect(taken.status).toBe(409);
    expect(await json(taken)).toEqual({ error: { code: "name_taken" } });

    const limited = await app.request("/api/greet?name=Limited");
    expect(limited.status).toBe(429);
    expect(await json(limited)).toEqual({ error: { code: "rate_limited" } });
  });

  it("answers internal_error for an unexpected failure and never leaks its message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = buildApp();
    const response = await app.request("/api/greet?name=Boom");
    expect(response.status).toBe(500);
    const body = await json(response);
    expect(body).toEqual({ error: { code: "internal_error" } });
    expect(console.error).toHaveBeenCalled();
  });

  it("answers JSON that must not be cached", async () => {
    const { app } = buildApp();
    const response = await app.request("/api/greet?name=Anna");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers not_found as JSON for an unknown path", async () => {
    const { app } = buildApp();
    const response = await app.request("/api/nothing-here");
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: { code: "not_found" } });
  });
});
