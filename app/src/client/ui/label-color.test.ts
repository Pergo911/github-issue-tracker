import { describe, expect, it } from "vitest";
import { labelColorVars } from "./label-color.ts";

// Worked examples of the RGB-to-HSL conversion, from the definition (not from the code under test).
describe("labelColorVars", () => {
  it.each([
    ["ffffff", { r: 255, g: 255, b: 255, h: 0, s: 0, l: 100 }],
    ["000000", { r: 0, g: 0, b: 0, h: 0, s: 0, l: 0 }],
    ["ff0000", { r: 255, g: 0, b: 0, h: 0, s: 100, l: 50 }],
    ["00ff00", { r: 0, g: 255, b: 0, h: 120, s: 100, l: 50 }],
    ["0000ff", { r: 0, g: 0, b: 255, h: 240, s: 100, l: 50 }],
    ["808080", { r: 128, g: 128, b: 128, h: 0, s: 0, l: 50.2 }],
  ])("splits %s into the pill's channel variables", (hex, expected) => {
    const vars = labelColorVars(hex);
    expect(Number(vars["--label-r"])).toBe(expected.r);
    expect(Number(vars["--label-g"])).toBe(expected.g);
    expect(Number(vars["--label-b"])).toBe(expected.b);
    expect(Number(vars["--label-h"])).toBeCloseTo(expected.h, 0);
    expect(Number(vars["--label-s"])).toBeCloseTo(expected.s, 0);
    expect(Number(vars["--label-l"])).toBeCloseTo(expected.l, 0);
  });

  it("falls back to the fixed neutral grey (ededed) for an unset or malformed colour", () => {
    const grey = labelColorVars("ededed");
    expect(labelColorVars(null)).toEqual(grey);
    expect(labelColorVars("nope")).toEqual(grey);
    expect(labelColorVars("#0075CA")).toEqual(labelColorVars("0075ca"));
  });
});
