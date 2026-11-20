import { describe, expect, it } from "vitest";
import { checkChunks, type Manifest } from "./chunks.ts";

const entry = {
  "index.html": {
    file: "assets/index.js",
    src: "index.html",
    isEntry: true,
    dynamicImports: ["src/client/reporter/form.tsx", "src/client/staff/board.tsx"],
  },
  "src/client/reporter/form.tsx": {
    file: "assets/form.js",
    src: "src/client/reporter/form.tsx",
    isDynamicEntry: true,
    imports: ["index.html"],
  },
  "src/client/staff/board.tsx": {
    file: "assets/board.js",
    src: "src/client/staff/board.tsx",
    isDynamicEntry: true,
    imports: ["index.html"],
  },
} satisfies Manifest;

describe("checkChunks", () => {
  it("accepts a build whose staff routes are their own chunk, loaded lazily", () => {
    expect(checkChunks(entry)).toEqual([]);
  });

  it("fails when the app has no entry chunk", () => {
    expect(checkChunks({})).toEqual([expect.stringMatching(/no entry/i)]);
  });

  it("fails when no chunk holds the staff routes: they were merged into another chunk", () => {
    const merged: Manifest = {
      "index.html": { ...entry["index.html"], dynamicImports: ["src/client/reporter/form.tsx"] },
      "src/client/reporter/form.tsx": entry["src/client/reporter/form.tsx"],
    };
    expect(checkChunks(merged)).toEqual([expect.stringMatching(/staff.*own chunk/i)]);
  });

  it("fails when the entry chunk loads the staff chunk up front", () => {
    const eager: Manifest = {
      ...entry,
      "index.html": { ...entry["index.html"], imports: ["src/client/staff/board.tsx"] },
    };
    expect(checkChunks(eager).join("\n")).toMatch(/entry chunk loads .*staff/i);
  });

  it("fails when a reporter chunk pulls in the staff chunk, even through a shared chunk", () => {
    const leaky: Manifest = {
      ...entry,
      "src/client/reporter/form.tsx": {
        ...entry["src/client/reporter/form.tsx"],
        imports: ["index.html", "_shared.js"],
      },
      "_shared.js": { file: "assets/shared.js", imports: ["src/client/staff/board.tsx"] },
    };
    expect(checkChunks(leaky).join("\n")).toMatch(/reporter.*staff/i);
  });
});
