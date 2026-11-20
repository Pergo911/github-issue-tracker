import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { configSchema } from "../config/schema.ts";
import { referenceConfig } from "../seed/reference-config.ts";
import { renderEmail, truncateTitle } from "./render.ts";

const config = configSchema.parse(referenceConfig);
const withoutReply = configSchema.parse({
  ...referenceConfig,
  email: { ...referenceConfig.email, replyTo: "" },
});

describe("rendering an email (SPEC 4.6)", () => {
  it("sends the OTP as plain text from the configured sender, with the footer and reply-to", () => {
    const mail = renderEmail({
      config,
      sendingDomain: "mail.example.hu",
      template: "otp",
      to: "anna@example.hu",
      params: { code: "042917", minutes: 10 },
    });
    expect(mail.from).toBe("Rózsa Társasház <reports@mail.example.hu>");
    expect(mail.to).toBe("anna@example.hu");
    expect(mail.replyTo).toBe("gondnok@example.org");
    expect(mail.subject).toBe("Ellenőrző kód a hibabejelentéshez");
    expect(mail.text).toContain("Az ellenőrző kódja: 042917");
    expect(mail.text).toContain("A kód 10 percig érvényes");
    expect(
      mail.text.endsWith(
        "Automatikus üzenet a Rózsa Társasház hibabejelentő rendszeréből — válaszoljon erre a levélre, ha a gondnokot szeretné elérni",
      ),
    ).toBe(true);
    expect(mail).not.toHaveProperty("html");
  });

  it("omits reply_to and the footer's reply clause when no reply-to is configured", () => {
    const mail = renderEmail({
      config: withoutReply,
      sendingDomain: "mail.example.hu",
      template: "otp",
      to: "anna@example.hu",
      params: { code: "123456", minutes: 10 },
    });
    expect(mail.replyTo).toBeUndefined();
    expect(
      mail.text.endsWith("Automatikus üzenet a Rózsa Társasház hibabejelentő rendszeréből"),
    ).toBe(true);
    expect(mail.text).not.toContain("{reply}");
    expect(mail.text).not.toContain("válaszoljon");
  });

  it("names the Report in the subject with the title cut to 50 characters, and gives the full title in the body", () => {
    const title = "Nagyon hosszú cím ".repeat(6).trim();
    const mail = renderEmail({
      config,
      sendingDomain: "mail.example.hu",
      template: "submissionConfirmation",
      to: "anna@example.hu",
      params: { number: 7, title, link: "https://app.example/status/abc" },
    });
    expect(mail.subject).toBe(`Bejelentés #7 — „${truncateTitle(title)}” — beérkezett`);
    expect([...truncateTitle(title)].length).toBeLessThanOrEqual(50);
    expect(mail.text).toContain(`Cím: ${title}`);
    expect(mail.text).toContain("https://app.example/status/abc");
  });

  it("truncates only titles longer than 50 characters", () => {
    expect(truncateTitle("short")).toBe("short");
    expect(truncateTitle("x".repeat(50))).toBe("x".repeat(50));
    expect(truncateTitle("x".repeat(51))).toBe(`${"x".repeat(49)}…`);
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (title) => {
        expect([...truncateTitle(title)].length).toBeLessThanOrEqual(50);
      }),
    );
  });

  it("fills placeholders in one pass: a title that looks like a placeholder stays text", () => {
    const mail = renderEmail({
      config,
      sendingDomain: "mail.example.hu",
      template: "submissionConfirmation",
      to: "anna@example.hu",
      params: { number: 1, title: "{link} {number}", link: "https://app.example/status/x" },
    });
    expect(mail.text).toContain("Cím: {link} {number}");
  });

  it("quotes a display name that needs it", () => {
    const quoted = configSchema.parse({
      ...referenceConfig,
      email: { ...referenceConfig.email, senderName: "Rózsa, Társasház" },
    });
    const mail = renderEmail({
      config: quoted,
      sendingDomain: "mail.example.hu",
      template: "otp",
      to: "a@b.hu",
      params: { code: "111111", minutes: 10 },
    });
    expect(mail.from).toBe('"Rózsa, Társasház" <reports@mail.example.hu>');
  });
});
