import { describe, expect, it } from "vitest";
import { localWorldPlugin, type LocalWorldPlan } from "./local-world.ts";

const samplePlan: LocalWorldPlan = {
  fakesPort: 45123,
  vars: {},
  githubApiBase: "http://127.0.0.1:45123/github",
  botPublicKey: "",
  webhookSecret: "test-secret",
  stateDirectory: ".tmp/state",
};

describe("localWorldPlugin", () => {
  it("runs in serve mode only and injects the fake GitHub API base as head metadata", () => {
    const plugin = localWorldPlugin(samplePlan);
    expect(plugin.apply).toBe("serve");
    const hook = plugin.transformIndexHtml;
    expect(typeof hook).toBe("function");
    const tags = (hook as () => unknown[])();
    expect(tags).toEqual([
      {
        tag: "meta",
        attrs: { name: "local-world-github-api-base", content: samplePlan.githubApiBase },
        injectTo: "head",
      },
    ]);
  });
});
