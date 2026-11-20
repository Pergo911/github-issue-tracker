import { describe, expect, it } from "vitest";
import { configSchema } from "../config/schema.ts";
import { referenceConfig } from "./reference-config.ts";

// The expected values below are SPEC Appendix A, written out independently of the seed module.
describe("reference Deployment seed (SPEC Appendix A)", () => {
  const config = configSchema.parse(referenceConfig);
  const ids = (values: { id: string }[]) => values.map((value) => value.id);

  it("satisfies the configuration schema", () => {
    expect(configSchema.safeParse(referenceConfig).success).toBe(true);
  });

  it("is Hungarian, in Budapest", () => {
    expect(config.language).toBe("hu");
    expect(config.timezone).toBe("Europe/Budapest");
  });

  it("has the Appendix A taxonomy, in order", () => {
    expect(ids(config.taxonomy.category)).toEqual([
      "electrical",
      "plumbing",
      "heating-cooling",
      "elevator",
      "structural",
      "doors-windows",
      "common-areas",
      "safety",
      "other",
    ]);
    expect(ids(config.taxonomy.location)).toEqual([
      "basement",
      "ground-floor",
      "floor-1",
      "floor-2",
      "floor-3",
      "stairwell",
      "elevator",
      "roof",
      "courtyard",
      "garage",
      "outdoor-other",
    ]);
    expect(ids(config.taxonomy.priority)).toEqual(["low", "normal", "high", "urgent"]);
    expect(ids(config.taxonomy.status)).toEqual(["new", "in-progress", "on-hold"]);
  });

  it("flags Statuses as Appendix A says", () => {
    const [created, inProgress, onHold] = config.taxonomy.status;
    expect(created).toMatchObject({ initial: true, notify: false });
    expect(inProgress).toMatchObject({ initial: false, notify: true });
    expect(onHold).toMatchObject({ initial: false, notify: true });
  });

  it("uses the Appendix A colours", () => {
    const colours = (values: { id: string; color?: string | undefined }[]) =>
      Object.fromEntries(values.map((value) => [value.id, value.color]));
    expect(colours(config.taxonomy.category)).toEqual({
      electrical: "fbca04",
      plumbing: "0075ca",
      "heating-cooling": "d93f0b",
      elevator: "7057ff",
      structural: "8b6f47",
      "doors-windows": "a2eeef",
      "common-areas": "008672",
      safety: "d73a4a",
      other: "cfd3d7",
    });
    expect(new Set(config.taxonomy.location.map((value) => value.color))).toEqual(
      new Set(["ededed"]),
    );
    expect(colours(config.taxonomy.priority)).toEqual({
      low: "c2e0c6",
      normal: "fef2c0",
      high: "f9a03f",
      urgent: "d73a4a",
    });
    expect(colours(config.taxonomy.status)).toEqual({
      new: "1d76db",
      "in-progress": "fbca04",
      "on-hold": "cfd3d7",
    });
  });

  it("has Hungarian display names, notices and all six templates", () => {
    expect(config.emergencyNotice).toMatch(/112/);
    expect(config.codeSentHelp.length).toBeGreaterThan(20);
    expect(Object.keys(config.email.templates).sort()).toEqual([
      "closed",
      "linkReissued",
      "otp",
      "reopened",
      "statusEntered",
      "submissionConfirmation",
    ]);
    for (const value of [...config.taxonomy.category, ...config.taxonomy.status]) {
      expect(value.name).not.toBe(value.id);
    }
  });

  it("puts the Status link into every Report email and the code into the code email", () => {
    const { templates } = config.email;
    expect(templates.otp.body).toContain("{code}");
    for (const key of [
      "submissionConfirmation",
      "closed",
      "reopened",
      "statusEntered",
      "linkReissued",
    ] as const) {
      expect(templates[key].body, key).toContain("{link}");
      expect(templates[key].subject, key).toContain("{number}");
      expect(templates[key].subject, key).toContain("{title}");
    }
    expect(templates.closed.body).toContain("{reason}");
    expect(templates.statusEntered.body).toContain("{status}");
    expect(config.email.footer).toContain("{reply}");
  });
});
