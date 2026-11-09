import { describe, expect, it } from "vitest";
import { runRecovery } from "./recovery.ts";

// The operator CLI against a scripted Worker: what it sends (the operator's token, the right endpoint and
// selector) and what it prints. The endpoints themselves are tested in src/worker/routes/recovery-admin.test.ts.

function harness(answer: (url: URL, init: RequestInit) => Response) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const lines: string[] = [];
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(answer(url, init ?? {}));
  }) as typeof fetch;
  return {
    calls,
    lines,
    run: (argv: string[], environment: Record<string, string | undefined> = {}) =>
      runRecovery(argv, {
        fetcher,
        log: (line) => lines.push(line),
        ghToken: () => "gh-token",
        environment,
      }),
  };
}

describe("the recovery CLI", () => {
  it("lists with the operator's own token and prints a line per attempt", async () => {
    const cli = harness(() =>
      Response.json({
        attempts: [{ reference: "A1B2-C3D4", emailHash: "x", phase: "unresolved", since: 0 }],
      }),
    );
    await cli.run(["list", "--url", "https://app.example/"]);
    expect(cli.calls[0]?.url.href).toBe("https://app.example/api/admin/recovery");
    expect(new Headers(cli.calls[0]?.init.headers).get("authorization")).toBe("Bearer gh-token");
    expect(cli.lines).toEqual(["A1B2-C3D4  unresolved  since 1970-01-01T00:00:00.000Z"]);
  });

  it("prefers --token, then GITHUB_TOKEN, to asking gh", async () => {
    const cli = harness(() => Response.json({ attempts: [] }));
    await cli.run(["list", "--url", "https://app.example", "--token", "flag-token"], {
      GITHUB_TOKEN: "env",
    });
    await cli.run(["list"], { APP_URL: "https://app.example", GITHUB_TOKEN: "env-token" });
    expect(cli.calls.map((call) => new Headers(call.init.headers).get("authorization"))).toEqual([
      "Bearer flag-token",
      "Bearer env-token",
    ]);
    expect(cli.lines).toEqual(["No attempt needs a person.", "No attempt needs a person."]);
  });

  it("inspects by email or by reference, and prints the marker line to look for", async () => {
    const cli = harness(() =>
      Response.json({
        reference: "A1B2-C3D4",
        emailHash: "h",
        email: "anna@example.hu",
        phase: "unresolved",
        issueNumber: null,
        markerLine: "<!-- fault-report-attempt: abc -->",
        title: "Elakadt a lift",
        category: "elevator",
        location: "stairwell",
        startedAt: 0,
        matches: [],
      }),
    );
    await cli.run(["inspect", "--url", "https://app.example", "--email", "anna@example.hu"]);
    await cli.run(["inspect", "--url", "https://app.example", "--reference", "A1B2-C3D4"]);
    expect(cli.calls[0]?.url.search).toBe("?email=anna%40example.hu");
    expect(cli.calls[1]?.url.search).toBe("?reference=A1B2-C3D4");
    expect(cli.lines).toContain("Marker:     <!-- fault-report-attempt: abc -->");
    expect(cli.lines).toContain("Scan:       no issue carries the marker");
  });

  it("associates an issue and discards, posting JSON", async () => {
    const cli = harness((url) =>
      url.pathname.endsWith("associate")
        ? Response.json({ outcome: "complete", number: 12 })
        : Response.json({ discarded: true }),
    );
    await cli.run([
      "associate",
      "--url",
      "https://app.example",
      "--reference",
      "A1B2-C3D4",
      "--issue",
      "12",
    ]);
    await cli.run(["discard", "--url", "https://app.example", "--email", "anna@example.hu"]);
    expect(JSON.parse(String(cli.calls[0]?.init.body))).toEqual({
      reference: "A1B2-C3D4",
      issueNumber: 12,
    });
    expect(JSON.parse(String(cli.calls[1]?.init.body))).toEqual({ email: "anna@example.hu" });
    expect(cli.lines[0]).toBe("Issue #12 is linked and its mappings are written.");
  });

  it("fails with the error code the Worker gave, and on a missing or doubled selector", async () => {
    const refusing = harness(() =>
      Response.json({ error: { code: "issue_unverified" } }, { status: 422 }),
    );
    await expect(
      refusing.run([
        "associate",
        "--url",
        "https://app.example",
        "--reference",
        "A1B2-C3D4",
        "--issue",
        "3",
      ]),
    ).rejects.toThrow("associate failed: issue_unverified");
    const cli = harness(() => Response.json({}));
    await expect(cli.run(["discard", "--url", "https://app.example"])).rejects.toThrow(
      "--reference or --email",
    );
    await expect(
      cli.run([
        "discard",
        "--url",
        "https://app.example",
        "--email",
        "a@b.hu",
        "--reference",
        "A1B2-C3D4",
      ]),
    ).rejects.toThrow("--reference or --email");
    await expect(
      cli.run(["associate", "--url", "https://app.example", "--email", "a@b.hu"]),
    ).rejects.toThrow("--issue");
    await expect(cli.run(["list"], {})).rejects.toThrow("No app URL");
    await expect(cli.run(["nonsense", "--url", "https://app.example"])).rejects.toThrow(
      "Unknown command",
    );
    expect(cli.calls).toEqual([]);
  });
});
