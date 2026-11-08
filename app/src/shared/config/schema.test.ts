import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { configSchema, labelName } from "./schema.ts";

type RawConfig = Record<string, any>;

function validConfig(overrides: RawConfig = {}): RawConfig {
  const template = (subject: string) => ({ subject, body: `${subject} {link}` });
  return {
    language: "hu",
    timezone: "Europe/Budapest",
    displayName: "Példa Társasház",
    emergencyNotice: "Tűz esetén hívja a 112-t.",
    codeSentHelp: "Nem érkezett meg a kód? Kérjen segítséget a gondnoktól.",
    taxonomy: {
      category: [{ id: "electrical", name: "Elektromos", color: "fbca04" }],
      location: [{ id: "basement", name: "Pince" }],
      priority: [
        { id: "low", name: "Alacsony" },
        { id: "high", name: "Magas" },
      ],
      status: [
        { id: "new", name: "Új", initial: true },
        { id: "in-progress", name: "Folyamatban", notify: true },
      ],
    },
    email: {
      senderLocalPart: "reports",
      senderName: "Példa Társasház",
      replyTo: "gondnok@example.org",
      replyClause: "válaszoljon a levélre",
      footer: "Automatikus üzenet. {reply}",
      templates: {
        otp: template("Kód"),
        submissionConfirmation: template("Beküldve"),
        closed: template("Lezárva"),
        reopened: template("Újranyitva"),
        statusEntered: template("Állapotváltozás"),
        linkReissued: template("Új hivatkozás"),
      },
    },
    dailyCodeBudget: 40,
    ...overrides,
  };
}

function withStatus(status: unknown[]): RawConfig {
  const base = validConfig();
  return { ...base, taxonomy: { ...base["taxonomy"], status } };
}

function withValue(dimension: string, value: Record<string, unknown>): RawConfig {
  const base = validConfig();
  return { ...base, taxonomy: { ...base["taxonomy"], [dimension]: [value] } };
}

describe("configSchema", () => {
  it("accepts a complete configuration and fills the documented defaults", () => {
    const { timezone: _t, dailyCodeBudget: _b, language: _l, ...rest } = validConfig();
    const config = configSchema.parse(rest);
    expect(config.language).toBe("en");
    expect(config.timezone).toBe("UTC");
    expect(config.dailyCodeBudget).toBe(40);
    expect(config.taxonomy.status[0]).toMatchObject({ initial: true, notify: false });
  });

  describe("Status invariants", () => {
    it("requires exactly one initial Status", () => {
      expect(configSchema.safeParse(withStatus([{ id: "new", name: "Új" }])).success).toBe(false);
      expect(
        configSchema.safeParse(
          withStatus([
            { id: "new", name: "Új", initial: true },
            { id: "open", name: "Nyitott", initial: true },
          ]),
        ).success,
      ).toBe(false);
    });

    it("holds for any number of Statuses and any placement of the initial flag", () => {
      fc.assert(
        fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (flags) => {
          const status = flags.map((initial, index) => ({
            id: `status-${index}`,
            name: `Status ${index}`,
            ...(initial ? { initial: true } : {}),
          }));
          const accepted = configSchema.safeParse(withStatus(status)).success;
          expect(accepted).toBe(flags.filter(Boolean).length === 1);
        }),
      );
    });

    it("allows notify on a Status", () => {
      expect(configSchema.safeParse(validConfig()).success).toBe(true);
    });

    it("rejects the notify flag on every other dimension", () => {
      for (const dimension of ["category", "location", "priority"]) {
        const result = configSchema.safeParse(
          withValue(dimension, { id: "thing", name: "Valami", notify: true }),
        );
        expect(result.success, dimension).toBe(false);
      }
    });

    it("rejects the initial flag on every other dimension", () => {
      expect(
        configSchema.safeParse(
          withValue("priority", { id: "low", name: "Alacsony", initial: true }),
        ).success,
      ).toBe(false);
    });
  });

  describe("values", () => {
    it("requires unique ids within a dimension and keeps their order", () => {
      const base = validConfig();
      const duplicated = {
        ...base,
        taxonomy: {
          ...base["taxonomy"],
          priority: [
            { id: "low", name: "Alacsony" },
            { id: "low", name: "Még alacsonyabb" },
          ],
        },
      };
      expect(configSchema.safeParse(duplicated).success).toBe(false);

      const parsed = configSchema.parse(validConfig());
      expect(parsed.taxonomy.priority.map((value) => value.id)).toEqual(["low", "high"]);
    });

    it("lets the same id exist in different dimensions", () => {
      const base = validConfig();
      const config = {
        ...base,
        taxonomy: {
          ...base["taxonomy"],
          location: [{ id: "elevator", name: "Lift" }],
          category: [{ id: "elevator", name: "Felvonó" }],
        },
      };
      expect(configSchema.safeParse(config).success).toBe(true);
    });

    it("requires every dimension to hold at least one value", () => {
      const base = validConfig();
      expect(
        configSchema.safeParse({ ...base, taxonomy: { ...base["taxonomy"], category: [] } })
          .success,
      ).toBe(false);
    });

    it("rejects empty and blank display names, for values and for the Organization", () => {
      for (const name of ["", "   ", "\n\t"]) {
        expect(
          configSchema.safeParse(withValue("category", { id: "plumbing", name })).success,
        ).toBe(false);
        expect(configSchema.safeParse(validConfig({ displayName: name })).success).toBe(false);
      }
    });

    it("rejects an unknown extra key on a value", () => {
      expect(
        configSchema.safeParse(withValue("category", { id: "plumbing", name: "Víz", weight: 3 }))
          .success,
      ).toBe(false);
    });
  });

  describe("identifiers", () => {
    const kebab = fc
      .array(fc.stringMatching(/^[a-z0-9]{1,8}$/), { minLength: 1, maxLength: 4 })
      .map((parts) => parts.join("-"));

    it("accepts lowercase kebab-case, whatever its parts", () => {
      fc.assert(
        fc.property(kebab, (id) => {
          expect(configSchema.safeParse(withValue("category", { id, name: "Név" })).success).toBe(
            true,
          );
        }),
      );
    });

    it("rejects anything that is not lowercase kebab-case", () => {
      const bad = [
        "Electrical",
        "heating_cooling",
        "-leading",
        "trailing-",
        "double--dash",
        "has space",
        "ékezet",
        "",
        "a:b",
      ];
      for (const id of bad) {
        expect(configSchema.safeParse(withValue("category", { id, name: "Név" })).success, id).toBe(
          false,
        );
      }
    });

    it("rejects a value whose dimension:value label would exceed GitHub's 50 characters", () => {
      const room = 50 - "category:".length;
      expect(
        configSchema.safeParse(withValue("category", { id: "a".repeat(room + 1), name: "Név" }))
          .success,
      ).toBe(false);
      expect(
        configSchema.safeParse(withValue("category", { id: "a".repeat(room), name: "Név" }))
          .success,
      ).toBe(true);
    });

    it("builds the label name as dimension:value", () => {
      expect(labelName("category", "heating-cooling")).toBe("category:heating-cooling");
    });
  });

  describe("colours", () => {
    it("accepts optional six-digit hex colours without a hash", () => {
      for (const color of ["fbca04", "FBCA04", "000000", "ededed"]) {
        expect(
          configSchema.safeParse(withValue("category", { id: "x", name: "N", color })).success,
          color,
        ).toBe(true);
      }
      expect(configSchema.safeParse(withValue("category", { id: "x", name: "N" })).success).toBe(
        true,
      );
    });

    it("rejects hashes, short and long forms and non-hex digits", () => {
      for (const color of ["#fbca04", "fbc", "fbca0", "fbca0400", "gggggg", "", "red"]) {
        expect(
          configSchema.safeParse(withValue("category", { id: "x", name: "N", color })).success,
          color,
        ).toBe(false);
      }
    });
  });

  describe("language and timezone", () => {
    it("falls back to English for an unset or unknown language", () => {
      for (const language of [undefined, "de", "", 5]) {
        expect(configSchema.parse(validConfig({ language })).language).toBe("en");
      }
      expect(configSchema.parse(validConfig({ language: "hu" })).language).toBe("hu");
    });

    it("accepts IANA time zones and rejects anything else", () => {
      expect(configSchema.safeParse(validConfig({ timezone: "America/New_York" })).success).toBe(
        true,
      );
      expect(configSchema.safeParse(validConfig({ timezone: "Mars/Olympus_Mons" })).success).toBe(
        false,
      );
    });
  });

  describe("email and limits", () => {
    it("lets reply-to be empty, since the send then goes out without it", () => {
      const base = validConfig();
      expect(
        configSchema.safeParse({ ...base, email: { ...base["email"], replyTo: "" } }).success,
      ).toBe(true);
      expect(
        configSchema.safeParse({ ...base, email: { ...base["email"], replyTo: "not an address" } })
          .success,
      ).toBe(false);
    });

    it("requires all six templates", () => {
      const base = validConfig();
      const { otp: _otp, ...five } = base["email"].templates;
      expect(
        configSchema.safeParse({ ...base, email: { ...base["email"], templates: five } }).success,
      ).toBe(false);
    });

    it("requires a positive whole daily code budget", () => {
      for (const dailyCodeBudget of [0, -1, 1.5]) {
        expect(
          configSchema.safeParse(validConfig({ dailyCodeBudget })).success,
          String(dailyCodeBudget),
        ).toBe(false);
      }
    });

    it("records the last editor when present", () => {
      const lastEditor = { editedBy: "pergo911", editedAt: "2026-11-08T10:00:00.000Z" };
      expect(configSchema.parse(validConfig({ lastEditor })).lastEditor).toEqual(lastEditor);
      expect(
        configSchema.safeParse(
          validConfig({ lastEditor: { editedBy: "x", editedAt: "yesterday" } }),
        ).success,
      ).toBe(false);
    });
  });
});
