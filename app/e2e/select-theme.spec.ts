import type { Page } from "@playwright/test";
import { hu } from "../src/shared/i18n/hu.ts";
import { COLOR_SCHEMES, type ColorScheme } from "./screens.ts";
import { urlFor } from "./support/servers.ts";
import { waitForVisualSettle } from "./support/settle.ts";
import { staffToken, startSignedIn } from "./support/staff.ts";
import { expect, test } from "./support/test.ts";
import { SLOW } from "./support/timings.ts";

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(cssColor: string): Rgba {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
    cssColor.trim(),
  );
  if (!match) {
    throw new Error(`Unexpected CSS color format: ${cssColor}`);
  }
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function relativeLuminance({ r, g, b }: Rgba): number {
  const linearize = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(fg: Rgba, bg: Rgba): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

interface SelectAudit {
  htmlColorScheme: string;
  popoverBg: string;
  popoverFg: string;
  selects: {
    id: string;
    backgroundColor: string;
    color: string;
    options: { backgroundColor: string; color: string }[];
    optgroups: { backgroundColor: string; color: string }[];
  }[];
  syntheticOptgroup?: {
    groupBg: string;
    groupColor: string;
    optionBg: string;
    optionColor: string;
  };
}

async function auditNativeSelects(
  page: Page,
  options: { includeSyntheticOptgroup?: boolean } = {},
): Promise<Record<ColorScheme, SelectAudit>> {
  const results = {} as Record<ColorScheme, SelectAudit>;

  for (const scheme of COLOR_SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await waitForVisualSettle(page);

    const audit = await page.evaluate((withOptgroup) => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = "var(--popover)";
      probe.style.color = "var(--popover-foreground)";
      document.body.appendChild(probe);

      let syntheticSelect: HTMLSelectElement | undefined;
      try {
        const probeStyle = getComputedStyle(probe);
        const popoverBg = probeStyle.backgroundColor;
        const popoverFg = probeStyle.color;

        const selects = Array.from(document.querySelectorAll("select")).map((select) => {
          const selectStyle = getComputedStyle(select);
          return {
            id: select.id || select.name || "",
            backgroundColor: selectStyle.backgroundColor,
            color: selectStyle.color,
            options: Array.from(select.querySelectorAll("option")).map((option) => {
              const style = getComputedStyle(option);
              return { backgroundColor: style.backgroundColor, color: style.color };
            }),
            optgroups: Array.from(select.querySelectorAll("optgroup")).map((optgroup) => {
              const style = getComputedStyle(optgroup);
              return { backgroundColor: style.backgroundColor, color: style.color };
            }),
          };
        });

        let syntheticOptgroup: SelectAudit["syntheticOptgroup"];
        if (withOptgroup) {
          syntheticSelect = document.createElement("select");
          const group = document.createElement("optgroup");
          group.label = "g";
          const option = document.createElement("option");
          option.textContent = "o";
          group.appendChild(option);
          syntheticSelect.appendChild(group);
          document.body.appendChild(syntheticSelect);
          const groupStyle = getComputedStyle(group);
          const optionStyle = getComputedStyle(option);
          syntheticOptgroup = {
            groupBg: groupStyle.backgroundColor,
            groupColor: groupStyle.color,
            optionBg: optionStyle.backgroundColor,
            optionColor: optionStyle.color,
          };
        }

        return {
          htmlColorScheme: getComputedStyle(document.documentElement).colorScheme,
          popoverBg,
          popoverFg,
          selects,
          syntheticOptgroup,
        };
      } finally {
        syntheticSelect?.remove();
        probe.remove();
      }
    }, options.includeSyntheticOptgroup ?? false);

    expect(audit.htmlColorScheme, `${scheme}: html color-scheme`).toContain("light");
    expect(audit.htmlColorScheme, `${scheme}: html color-scheme`).toContain("dark");

    const popoverBg = parseColor(audit.popoverBg);
    const popoverFg = parseColor(audit.popoverFg);
    expect(popoverBg.a, `${scheme}: --popover must be opaque`).toBe(1);
    expect(
      contrastRatio(popoverFg, popoverBg),
      `${scheme}: --popover contrast must meet WCAG AA`,
    ).toBeGreaterThanOrEqual(4.5);

    for (const select of audit.selects) {
      expect(select.options.length, `${scheme}: select ${select.id} has options`).toBeGreaterThan(
        0,
      );
      for (const option of select.options) {
        const bg = parseColor(option.backgroundColor);
        const fg = parseColor(option.color);
        expect(option.backgroundColor, `${scheme}: option bg must not be transparent`).not.toBe(
          "rgba(0, 0, 0, 0)",
        );
        expect(bg.a, `${scheme}: option bg alpha`).toBe(1);
        expect(option.backgroundColor, `${scheme}: option bg matches --popover`).toBe(
          audit.popoverBg,
        );
        expect(option.color, `${scheme}: option color matches --popover-foreground`).toBe(
          audit.popoverFg,
        );
        expect(contrastRatio(fg, bg), `${scheme}: option contrast ratio`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
      for (const optgroup of select.optgroups) {
        expect(optgroup.backgroundColor, `${scheme}: optgroup bg matches --popover`).toBe(
          audit.popoverBg,
        );
        expect(optgroup.color, `${scheme}: optgroup color matches --popover-foreground`).toBe(
          audit.popoverFg,
        );
      }
    }

    if (audit.syntheticOptgroup) {
      expect(audit.syntheticOptgroup.groupBg, `${scheme}: synthetic optgroup bg`).toBe(
        audit.popoverBg,
      );
      expect(audit.syntheticOptgroup.groupColor, `${scheme}: synthetic optgroup color`).toBe(
        audit.popoverFg,
      );
      expect(audit.syntheticOptgroup.optionBg, `${scheme}: synthetic option bg`).toBe(
        audit.popoverBg,
      );
      expect(audit.syntheticOptgroup.optionColor, `${scheme}: synthetic option color`).toBe(
        audit.popoverFg,
      );
    }

    results[scheme] = audit;
  }

  const lightBg = parseColor(results.light.popoverBg);
  const darkBg = parseColor(results.dark.popoverBg);
  expect(results.dark.popoverBg).not.toBe(results.light.popoverBg);
  expect(relativeLuminance(lightBg)).toBeGreaterThan(0.9);
  expect(relativeLuminance(darkBg)).toBeLessThan(0.1);

  return results;
}

test.describe("native <select> popup theme tokens in light and dark mode", () => {
  test("SubmissionForm (/report) native selects paint opaque popover options", async ({ page }) => {
    await page.goto(urlFor("seeded", "/report"));
    await expect(page.locator("#category")).toBeVisible(SLOW);
    const results = await auditNativeSelects(page);
    expect(results.dark.selects.length).toBeGreaterThanOrEqual(2);
  });

  test("FilterBar (/staff/reports) preserves transparent select chips and paints opaque popover options", async ({
    page,
  }) => {
    const { token } = await staffToken("e2e-select-filter", "maintenance");
    await startSignedIn(page, token);
    await page.goto(urlFor("seeded", "/staff/reports?category=plumbing&priority=high"));
    await expect(page.getByRole("heading", { level: 1, name: hu["reports.title"] })).toBeVisible(
      SLOW,
    );
    await expect(page.locator("select").nth(5)).toBeVisible(SLOW);

    const results = await auditNativeSelects(page);
    expect(results.dark.selects.length).toBeGreaterThanOrEqual(6);
    for (const scheme of COLOR_SCHEMES) {
      for (const select of results[scheme].selects) {
        expect(
          select.backgroundColor,
          `${scheme}: FilterBar <select> stays transparent so active chip tint shows through`,
        ).toBe("rgba(0, 0, 0, 0)");
      }
    }
  });

  test("ConfigurationPage (/staff/configuration?section=system) native select paints opaque popover options", async ({
    page,
  }) => {
    const { token } = await staffToken("e2e-select-config", "admin");
    await startSignedIn(page, token);
    await page.goto(urlFor("seeded", "/staff/configuration?section=system"));
    await expect(page.locator("#language")).toBeVisible(SLOW);

    const results = await auditNativeSelects(page);
    expect(results.dark.selects.length).toBeGreaterThanOrEqual(1);
  });

  test("MembersPage (/staff/members) native selects and <optgroup> paint opaque popover colors", async ({
    page,
  }) => {
    const { token } = await staffToken("e2e-select-members", "admin");
    await startSignedIn(page, token);
    await page.goto(urlFor("seeded", "/staff/members"));
    await expect(page.locator("#staff-role")).toBeVisible(SLOW);

    const results = await auditNativeSelects(page, { includeSyntheticOptgroup: true });
    expect(results.dark.selects.length).toBeGreaterThanOrEqual(1);
  });
});
