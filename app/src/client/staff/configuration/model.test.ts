import { describe, expect, it } from "vitest";
import { configSaveSchema } from "@shared/config/save.ts";
import { starterConfig } from "@shared/config/defaults.ts";
import { configSchema } from "@shared/config/schema.ts";
import { referenceConfig } from "@shared/seed/reference-config.ts";
import {
  addValue,
  draftToPayload,
  moveValue,
  removeValue,
  setInitialStatus,
  slugify,
  toDraft,
} from "./model.ts";

const reference = () => configSchema.parse(referenceConfig);

describe("the draft round-trips the configuration", () => {
  it("turns the stored configuration into a draft and back into what the Worker accepts", () => {
    const payload = draftToPayload(toDraft(reference()));
    expect(configSaveSchema.parse(payload)).toEqual(configSaveSchema.parse(referenceConfig));
  });

  it("marks stored values as saved, so their identifier is fixed", () => {
    const draft = toDraft(reference());
    expect(draft.taxonomy.category.every((value) => value.saved)).toBe(true);
    expect(toDraft(null).taxonomy.category.every((value) => !value.saved)).toBe(true);
  });

  it("starts a fresh Deployment from the starter configuration", () => {
    expect(draftToPayload(toDraft(null))).toMatchObject({
      language: starterConfig.language,
      timezone: "UTC",
      displayName: "",
      dailyCodeBudget: 40,
    });
  });

  it("omits an empty colour and puts the Status flags on Status values only", () => {
    const draft = toDraft(reference());
    draft.taxonomy.category[0]!.color = "";
    const payload = draftToPayload(draft) as {
      taxonomy: { category: object[]; status: object[] };
    };
    expect(payload.taxonomy.category[0]).not.toHaveProperty("color");
    expect(payload.taxonomy.category[0]).not.toHaveProperty("initial");
    expect(payload.taxonomy.status[0]).toHaveProperty("initial", true);
  });

  it("sends the budget as a number", () => {
    const draft = toDraft(reference());
    draft.dailyCodeBudget = "55";
    expect((draftToPayload(draft) as { dailyCodeBudget: unknown }).dailyCodeBudget).toBe(55);
  });
});

describe("editing the values of a dimension", () => {
  it("adds a new, unsaved value at the end", () => {
    const draft = toDraft(reference());
    const next = addValue(draft.taxonomy.priority);
    expect(next).toHaveLength(draft.taxonomy.priority.length + 1);
    expect(next.at(-1)).toMatchObject({ id: "", name: "", saved: false, initial: false });
  });

  it("moves a value up or down and stops at the ends", () => {
    const list = toDraft(reference()).taxonomy.priority;
    const ids = (values: typeof list) => values.map((value) => value.id);
    expect(ids(moveValue(list, 1, -1))).toEqual(["normal", "low", "high", "urgent"]);
    expect(ids(moveValue(list, 1, 1))).toEqual(["low", "high", "normal", "urgent"]);
    expect(ids(moveValue(list, 0, -1))).toEqual(ids(list));
    expect(ids(moveValue(list, 3, 1))).toEqual(ids(list));
  });

  it("removes a value by its key", () => {
    const list = toDraft(reference()).taxonomy.priority;
    expect(removeValue(list, list[1]!.key).map((value) => value.id)).toEqual([
      "low",
      "high",
      "urgent",
    ]);
  });

  it("keeps exactly one initial Status whichever is chosen", () => {
    const status = toDraft(reference()).taxonomy.status;
    const next = setInitialStatus(status, status[2]!.key);
    expect(next.filter((value) => value.initial).map((value) => value.id)).toEqual(["on-hold"]);
  });
});

describe("slugify", () => {
  it("makes a lowercase kebab-case identifier from a display name", () => {
    expect(slugify("Víz- és csatornahiba")).toBe("viz-es-csatornahiba");
    expect(slugify("  2. emelet  ")).toBe("2-emelet");
    expect(slugify("Lift!!")).toBe("lift");
    expect(slugify("Ő")).toBe("o");
    expect(slugify("???")).toBe("");
  });
});
