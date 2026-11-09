import { describe, expect, it } from "vitest";
import { referenceConfig } from "../seed/reference-config.ts";
import { starterConfig } from "./defaults.ts";
import { configSchema } from "./schema.ts";
import { configSaveSchema, fieldErrorsOf, type ConfigFieldError } from "./save.ts";

const errorsOf = (value: unknown): ConfigFieldError[] => {
  const result = configSaveSchema.safeParse(value);
  return result.success ? [] : fieldErrorsOf(result.error);
};
const clone = () => configSchema.parse(referenceConfig);

describe("the starter configuration a fresh Deployment is pre-filled with", () => {
  it("is valid but for the two names only the Organization can supply", () => {
    expect(errorsOf(starterConfig)).toEqual([
      { path: "displayName", code: "required" },
      { path: "email.senderName", code: "required" },
    ]);
    expect(
      errorsOf({
        ...starterConfig,
        displayName: "Acme",
        email: { ...starterConfig.email, senderName: "Acme" },
      }),
    ).toEqual([]);
  });
});

describe("configSaveSchema", () => {
  it("accepts the reference configuration", () => {
    expect(errorsOf(referenceConfig)).toEqual([]);
  });

  it("does not take the last-editor block from the caller: the Worker writes it", () => {
    const parsed = configSaveSchema.parse({
      ...referenceConfig,
      lastEditor: { editedBy: "mallory", editedAt: "2020-01-01T00:00:00.000Z" },
    });
    expect("lastEditor" in parsed).toBe(false);
  });

  it("refuses an unknown language instead of quietly falling back to English", () => {
    expect(errorsOf({ ...referenceConfig, language: "de" })).toEqual([
      { path: "language", code: "invalid" },
    ]);
  });
});

describe("fieldErrorsOf names the field and a catalog code", () => {
  it("an empty display name is required", () => {
    expect(errorsOf({ ...referenceConfig, displayName: "  " })).toEqual([
      { path: "displayName", code: "required" },
    ]);
  });

  it("a duplicate identifier points at the second one", () => {
    const config = clone();
    config.taxonomy.category.push({ id: "plumbing", name: "Again", color: "ffffff" });
    expect(errorsOf(config)).toEqual([
      { path: `taxonomy.category.${config.taxonomy.category.length - 1}.id`, code: "duplicate" },
    ]);
  });

  it("an identifier that is not kebab-case, a bad colour and a long label name each say so", () => {
    const config = clone();
    config.taxonomy.location[0] = { id: "Ground Floor", name: "x", color: "red" };
    config.taxonomy.priority[0] = { id: "p".repeat(50), name: "x", color: "ededed" };
    expect(errorsOf(config)).toEqual(
      expect.arrayContaining([
        { path: "taxonomy.location.0.id", code: "kebab" },
        { path: "taxonomy.location.0.color", code: "colour" },
        { path: "taxonomy.priority.0.id", code: "label_length" },
      ]),
    );
  });

  it("zero or two initial Statuses is an error on the Status list", () => {
    const none = clone();
    for (const status of none.taxonomy.status) status.initial = false;
    expect(errorsOf(none)).toEqual([{ path: "taxonomy.status", code: "one_initial" }]);
    const two = clone();
    for (const status of two.taxonomy.status) status.initial = true;
    expect(errorsOf(two)).toEqual([{ path: "taxonomy.status", code: "one_initial" }]);
  });

  it("an empty dimension, a bad time zone, a bad reply-to and a zero budget", () => {
    const config = { ...clone(), timezone: "Mars/Olympus", dailyCodeBudget: 0 };
    config.taxonomy.category = [];
    config.email = { ...config.email, replyTo: "not-an-address" };
    expect(errorsOf(config)).toEqual(
      expect.arrayContaining([
        { path: "taxonomy.category", code: "required" },
        { path: "timezone", code: "timezone" },
        { path: "email.replyTo", code: "email" },
        { path: "dailyCodeBudget", code: "invalid_number" },
      ]),
    );
  });

  it("an over-long text is too_long", () => {
    expect(errorsOf({ ...referenceConfig, emergencyNotice: "x".repeat(1001) })).toEqual([
      { path: "emergencyNotice", code: "too_long" },
    ]);
  });
});
