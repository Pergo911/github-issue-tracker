import { describe, expect, it } from "vitest";
import { z } from "zod";
import { referenceConfig } from "../seed/reference-config.ts";
import { createProjection, PUBLIC_CONFIG_FIELDS, publicConfigSchema, toPublicConfig } from "./public.ts";
import { configSchema } from "./schema.ts";

describe("public projection", () => {
  const config = configSchema.parse(referenceConfig);

  it("holds exactly the fields SPEC 2.4 lets the SPA see", () => {
    const expected = ["codeSentHelp", "displayName", "emergencyNotice", "language", "taxonomy", "timezone"];
    expect(Object.keys(toPublicConfig(config)).sort()).toEqual(expected);
    expect([...PUBLIC_CONFIG_FIELDS].sort()).toEqual(expected);
  });

  it("carries the taxonomy with its names, colours, order and Status flags", () => {
    const { taxonomy } = toPublicConfig(config);
    expect(taxonomy.status.map((value) => value.id)).toEqual(["new", "in-progress", "on-hold"]);
    expect(taxonomy.status[0]).toMatchObject({ initial: true, notify: false });
    expect(taxonomy.status[1]).toMatchObject({ notify: true });
    expect(taxonomy.category[0]).toMatchObject({ id: "electrical", color: "fbca04" });
  });

  it("never carries the private parts", () => {
    const json = JSON.stringify(toPublicConfig(config));
    for (const privateText of [
      "email",
      "templates",
      "dailyCodeBudget",
      "lastEditor",
      "senderLocalPart",
      "replyTo",
      config.email.footer,
      config.email.templates.otp.body,
    ]) {
      expect(json).not.toContain(privateText);
    }
  });

  it("satisfies its own published schema", () => {
    expect(publicConfigSchema.safeParse(toPublicConfig(config)).success).toBe(true);
  });

  it("keeps a field added to the schema later private until the allowlist names it", () => {
    const extended = configSchema.extend({ internalNote: z.string() });
    const project = createProjection(extended, PUBLIC_CONFIG_FIELDS);
    const projected = project({ ...config, internalNote: "never public" });
    expect(projected).not.toHaveProperty("internalNote");
    expect(JSON.stringify(projected)).not.toContain("never public");
  });

  it("drops unknown properties that sit on the object at runtime", () => {
    const leaky = { ...config, secretFromTheFuture: "x" } as typeof config;
    expect(toPublicConfig(leaky)).not.toHaveProperty("secretFromTheFuture");
  });
});
