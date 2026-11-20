import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { resolveBotIdentity } from "./bot-identity.ts";

describe("resolveBotIdentity", () => {
  it("returns a valid pinned Bot identity without calling GitHub", async () => {
    const identity = await resolveBotIdentity({
      ...env,
      GITHUB_API_BASE: "https://unreachable.invalid",
      BOT_USER_ID: "354771587",
      BOT_LOGIN: "tarsashaz-demo-reports-bot[bot]",
    });
    expect(identity).toEqual({
      id: 354771587,
      login: "tarsashaz-demo-reports-bot[bot]",
      type: "Bot",
    });
  });

  it("fails fast when pinned Bot values are invalid or only half-set", async () => {
    const cases: { BOT_USER_ID?: string; BOT_LOGIN?: string }[] = [
      { BOT_USER_ID: "0", BOT_LOGIN: "reports-bot[bot]" },
      { BOT_USER_ID: "-5", BOT_LOGIN: "reports-bot[bot]" },
      { BOT_USER_ID: "not-a-number", BOT_LOGIN: "reports-bot[bot]" },
      { BOT_USER_ID: "42", BOT_LOGIN: "not-a-bot" },
      { BOT_USER_ID: "42", BOT_LOGIN: "" },
      { BOT_USER_ID: "", BOT_LOGIN: "reports-bot[bot]" },
    ];
    for (const pinned of cases) {
      await expect(resolveBotIdentity({ ...env, ...pinned })).rejects.toThrow(
        "Invalid pinned Bot identity",
      );
    }
  });

  it("discovers the Bot identity from GitHub when unpinned", async () => {
    const identity = await resolveBotIdentity({ ...env, BOT_USER_ID: "", BOT_LOGIN: "" });
    expect(identity).toMatchObject({
      login: "fault-reports-bot[bot]",
      type: "Bot",
    });
    expect(Number.isSafeInteger(identity.id) && identity.id > 0).toBe(true);
  });
});
