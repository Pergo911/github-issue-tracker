import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { listViewToParams, parseListView } from "./view-state.ts";

const parse = (query: string) => parseListView(new URLSearchParams(query));

describe("the List's view state in the URL", () => {
  it("defaults to open Reports with nothing else set", () => {
    expect(parse("")).toEqual({ state: "open", q: "" });
    expect(listViewToParams(parse("")).toString()).toBe("");
  });

  it("reads every filter, the search text and the state", () => {
    expect(
      parse(
        "state=closed&category=plumbing&location=floor-2&priority=high&status=new&assignee=mate&untriaged=1&q=csap",
      ),
    ).toEqual({
      state: "closed",
      category: "plumbing",
      location: "floor-2",
      priority: "high",
      status: "new",
      assignee: "mate",
      untriaged: true,
      q: "csap",
    });
  });

  it("falls back to the default for a value it does not understand, never throwing", () => {
    expect(parse("state=sideways&category=&untriaged=yes")).toEqual({ state: "open", q: "" });
    expect(parse("category=a&category=b").category).toBe("a");
  });

  it("round-trips any view through the URL", () => {
    const text = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter((value) => value.trim() === value);
    const view = fc.record(
      {
        state: fc.constantFrom("open", "closed"),
        category: text,
        location: text,
        priority: text,
        status: text,
        assignee: text,
        untriaged: fc.constant(true),
        q: text,
      },
      { requiredKeys: ["state", "q"] },
    );
    fc.assert(
      fc.property(view, (value) => {
        const expected = value;
        expect(parseListView(new URLSearchParams(listViewToParams(expected).toString()))).toEqual(
          expected,
        );
      }),
    );
  });

  it("leaves other parameters alone when they are handed back (the language switch of the test run)", () => {
    const params = listViewToParams({ state: "closed", q: "" }, new URLSearchParams("lang=pseudo"));
    expect(params.get("lang")).toBe("pseudo");
    expect(params.get("state")).toBe("closed");
  });
});

describe("the Board/List toggle and the Reporter-comment view in the URL", () => {
  it("defaults to the List with no Reporter-comment chip or sort", () => {
    expect(parse("").layout).toBeUndefined();
    expect(parse("layout=board")).toMatchObject({ layout: "board" });
    expect(parse("reporter=1&sort=reporter")).toMatchObject({ reporter: true, sort: "reporter" });
    expect(parse("layout=wat&sort=wat")).toEqual({ state: "open", q: "" });
  });

  it("round-trips and leaves defaults out", () => {
    const view = parse("layout=board&reporter=1&sort=reporter");
    expect(listViewToParams(view).toString()).toBe("layout=board&reporter=1&sort=reporter");
  });
});
