import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_ORG, TEST_REPO } from "@fakes/testing/constants.ts";
import { configSchema } from "@shared/config/schema.ts";
import { referenceConfig } from "@shared/seed/reference-config.ts";
import { fakeClient, fakeWorld } from "../testing/world.ts";

// The configuration endpoints (SPEC 2.4): System admin only, validated with field errors, recorded with its
// last editor, and the save is the label sync (ADR 0002): create what is missing, recolour what differs, never
// delete or rename.

// KV persists across the tests of a file: each starts as a fresh Deployment.
beforeEach(async () => {
  await env.KV.delete("config");
});

const send = (method: string, path: string, token: string | undefined, body?: unknown) =>
  exports.default.fetch(`https://reports.test${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const admin = () => fakeWorld().control.addStaff({ login: "ada-admin", role: "admin" }).token;
const save = (token: string, config: unknown) =>
  send("PUT", "/api/staff/config", token, { config });
const clone = () => configSchema.parse(referenceConfig);
const stored = async () => env.KV.get("config", "json");
const labels = async (token: string) =>
  (
    await fakeClient().github("GET", `/repos/${TEST_ORG}/${TEST_REPO}/labels`, {
      token,
      query: { per_page: 100 },
    })
  ).json as { name: string; color: string }[];

describe("who may read and save the configuration", () => {
  it("refuses a caller without a token, and Triage and Read members", async () => {
    const maintenance = fakeWorld().control.addStaff({ login: "mate", role: "triage" }).token;
    const viewer = fakeWorld().control.addStaff({ login: "vera", role: "read" }).token;
    for (const [method, body] of [
      ["GET", undefined],
      ["PUT", { config: referenceConfig }],
    ] as const) {
      expect((await send(method, "/api/staff/config", undefined, body)).status).toBe(401);
      expect((await send(method, "/api/staff/config", maintenance, body)).status).toBe(403);
      expect((await send(method, "/api/staff/config", viewer, body)).status).toBe(403);
    }
    expect(await stored()).toBeNull();
  });
});

describe("a fresh Deployment", () => {
  it("reads as no configuration, and the first valid save creates the config key and the labels", async () => {
    const token = admin();
    expect(await (await send("GET", "/api/staff/config", token)).json()).toEqual({ config: null });
    expect((await send("GET", "/api/config/public", undefined)).status).toBe(404);

    const response = await save(token, referenceConfig);
    expect(response.status).toBe(200);
    const body = await response.json<{
      config: { lastEditor: { editedBy: string; editedAt: string } };
      sync: { created: string[]; recoloured: string[] };
    }>();
    expect(body.config.lastEditor.editedBy).toBe("ada-admin");
    expect(Date.parse(body.config.lastEditor.editedAt)).not.toBeNaN();
    expect(body.sync.created).toContain("category:plumbing");
    expect(body.sync.recoloured).toEqual([]);

    expect(configSchema.parse(await stored()).displayName).toBe(referenceConfig.displayName);
    expect((await send("GET", "/api/config/public", undefined)).status).toBe(200);
    const read = await (
      await send("GET", "/api/staff/config", token)
    ).json<{
      config: { displayName: string };
    }>();
    expect(read.config.displayName).toBe(referenceConfig.displayName);

    const made = await labels(token);
    expect(made.find((label) => label.name === "category:plumbing")?.color).toBe("0075ca");
    expect(made.find((label) => label.name === "status:new")?.color).toBe("1d76db");
  });

  it("does not take the last-editor block from the request", async () => {
    const token = admin();
    await save(token, {
      ...referenceConfig,
      lastEditor: { editedBy: "mallory", editedAt: "2020-01-01T00:00:00.000Z" },
    });
    const config = configSchema.parse(await stored());
    expect(config.lastEditor?.editedBy).toBe("ada-admin");
  });
});

describe("a refused save", () => {
  it("answers invalid_config with the fields, and writes neither the config nor any label", async () => {
    const token = admin();
    const config = clone();
    config.displayName = "";
    config.taxonomy.category.push({ id: "plumbing", name: "Again", color: "ffffff" });
    const response = await save(token, config);
    expect(response.status).toBe(422);
    const body = await response.json<{
      error: { code: string; fields: { path: string; code: string }[] };
    }>();
    expect(body.error.code).toBe("invalid_config");
    expect(body.error.fields).toEqual(
      expect.arrayContaining([
        { path: "displayName", code: "required" },
        { path: `taxonomy.category.${config.taxonomy.category.length - 1}.id`, code: "duplicate" },
      ]),
    );
    expect(await stored()).toBeNull();
    expect(await labels(token)).toEqual([]);
  });

  it("refuses a body that is not even an object", async () => {
    const response = await save(admin(), "nonsense");
    expect(response.status).toBe(422);
  });
});

describe("the save is the label sync", () => {
  it("recolours a label whose colour differs, creates a new value, and never deletes or renames", async () => {
    const token = admin();
    expect((await save(token, referenceConfig)).status).toBe(200);

    const edited = clone();
    edited.taxonomy.category = edited.taxonomy.category
      .filter((value) => value.id !== "other")
      .map((value) => (value.id === "plumbing" ? { ...value, color: "00ff00" } : value));
    edited.taxonomy.category.push({ id: "pest", name: "Pests", color: "123456" });
    edited.taxonomy.location[0] = { ...edited.taxonomy.location[0]!, name: "Cellar" };
    const response = await save(token, edited);
    expect(response.status).toBe(200);
    const { sync } = await response.json<{ sync: { created: string[]; recoloured: string[] } }>();
    expect(sync.created).toEqual(["category:pest"]);
    expect(sync.recoloured).toEqual(["category:plumbing"]);

    const after = await labels(token);
    expect(after.find((label) => label.name === "category:plumbing")?.color).toBe("00ff00");
    expect(after.find((label) => label.name === "category:pest")?.color).toBe("123456");
    // Removed from the configuration, still on GitHub; a renamed display name changes no label.
    expect(after.some((label) => label.name === "category:other")).toBe(true);
    expect(after.some((label) => label.name === "location:basement")).toBe(true);
  });

  it("gives a value with no colour the neutral grey, and a second identical save changes nothing", async () => {
    const token = admin();
    const config = clone();
    config.taxonomy.category[0] = { id: "electrical", name: "Elektromos hiba" };
    await save(token, config);
    expect((await labels(token)).find((l) => l.name === "category:electrical")?.color).toBe(
      "ededed",
    );
    const again = await (
      await save(token, config)
    ).json<{
      sync: { created: string[]; recoloured: string[] };
    }>();
    expect(again.sync).toEqual({ created: [], recoloured: [] });
  });

  it("leaves the configuration unsaved when GitHub cannot be reached for the sync", async () => {
    const token = admin();
    fakeWorld().control.addFault({
      service: "github",
      method: "POST",
      path: "/labels$",
      effect: { type: "status", status: 503 },
      times: null,
    });
    const response = await save(token, referenceConfig);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "upstream_unavailable" } });
    expect(await stored()).toBeNull();
  });
});
