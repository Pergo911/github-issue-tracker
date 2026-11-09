import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkHeaders } from "./headers.ts";
import { APP_ROOT } from "./state.ts";

describe("checkHeaders (SPEC 4.3: the Status link never leaks as a referrer)", () => {
  it("accepts the rule the app ships", () => {
    const shipped = readFileSync(join(APP_ROOT, "public", "_headers"), "utf8");
    expect(checkHeaders(shipped)).toEqual([]);
  });

  it("rejects a file with no /status/* rule, or a rule without the policy", () => {
    expect(checkHeaders("# nothing\n/other/*\n  X-Frame-Options: DENY\n")).toHaveLength(1);
    expect(checkHeaders("/status/*\n  X-Frame-Options: DENY\n")).toHaveLength(1);
    expect(
      checkHeaders("/other/*\n  Referrer-Policy: no-referrer\n/status/*\n  X: y\n"),
    ).toHaveLength(1);
  });
});
