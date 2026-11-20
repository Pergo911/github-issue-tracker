import { describe, expect, it } from "vitest";
import { createFormatter } from "./format.ts";

const now = Date.parse("2026-06-15T12:00:00Z");
const ago = (milliseconds: number) => new Date(now - milliseconds).toISOString();
const minute = 60_000;
const day = 24 * 60 * minute;

describe("relativeTime", () => {
  const en = createFormatter({ language: "en", timezone: "UTC" });
  const hu = createFormatter({ language: "hu", timezone: "Europe/Budapest" });

  it("picks the largest whole unit, in the Deployment's language", () => {
    expect(en.relativeTime(ago(10_000), now)).toBe("now");
    expect(en.relativeTime(ago(5 * minute), now)).toBe("5 minutes ago");
    expect(en.relativeTime(ago(3 * 60 * minute), now)).toBe("3 hours ago");
    expect(en.relativeTime(ago(3 * day), now)).toBe("3 days ago");
    expect(en.relativeTime(ago(40 * day), now)).toBe("last month");
    expect(en.relativeTime(ago(800 * day), now)).toBe("2 years ago");
    expect(hu.relativeTime(ago(3 * day), now)).toBe("3 nappal ezelőtt");
  });

  it("never reads in the future: a clock a little behind GitHub's still says now", () => {
    expect(en.relativeTime(new Date(now + 30_000).toISOString(), now)).toBe("now");
  });
});
