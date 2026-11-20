import { describe, expect, it } from "vitest";
import { correlationMarker } from "@shared/reports/body.ts";
import { selectMatches } from "./scan.ts";

// Which issues count as carrying an attempt's marker (ADR 0005): the exact line, from the expected Bot only.

const bot = { login: "fault-reports[bot]", id: 77 };
const marker = "AbCdEfGhIjKlMnOpQrStUv";
const user = (login: string, id: number, type: "Bot" | "User" = "Bot") =>
  ({ login, id, type }) as never;
const issue = (number: number, body: string | null, author = user(bot.login, bot.id), pr = false) =>
  ({ number, body, user: author, ...(pr ? { pull_request: {} } : {}) }) as never;

describe("selectMatches", () => {
  it("accepts the exact marker line authored by the expected Bot", () => {
    const body = `**Kategória:** Lift\n\n${correlationMarker(marker)}`;
    expect(selectMatches([issue(4, body)], marker, bot)).toEqual([4]);
  });

  it("ignores another marker, a marker only quoted inside text, a pull request and other authors", () => {
    const line = correlationMarker(marker);
    const issues = [
      issue(1, correlationMarker("someone-else-entirely")),
      issue(2, `valaki idézte: ${line} és tovább`),
      issue(3, line, user(bot.login, bot.id), true),
      issue(4, line, user("anna", 5, "User")),
      issue(5, line, user("other-app[bot]", 99)),
      issue(6, line, user(bot.login, 78)),
      issue(7, null),
    ];
    expect(selectMatches(issues, marker, bot)).toEqual([]);
  });

  it("returns every match, so two are left for a person", () => {
    const line = correlationMarker(marker);
    expect(selectMatches([issue(8, line), issue(9, line)], marker, bot)).toEqual([8, 9]);
  });
});
