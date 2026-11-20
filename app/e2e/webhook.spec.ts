import type { APIRequestContext } from "@playwright/test";
import type { AsyncControl } from "../fakes/control.ts";
import { controlUrl, urlFor } from "./support/servers.ts";
import { waitForMails } from "./support/mail.ts";
import { expect, test } from "./support/test.ts";

// The webhook receiver against the real dev server and the local world (ticket #26, SPEC 4.2, 4.6, 5): a Report
// is really filed through the Worker, Staff change it on the fake GitHub, and the fake's signed webhooks reach
// the receiver. Each test files its own Report under its own address, so tests never see one another's mail.

const githubBase = controlUrl("seeded").replace(/\/control$/, "/github");
let counter = 0;

interface Filed {
  number: number;
  token: string;
  email: string;
}

async function fileReport(request: APIRequestContext, world: AsyncControl): Promise<Filed> {
  const unique = `${Date.now()}-${++counter}-${Math.floor(Math.random() * 1e6)}`;
  const email = `hook-${unique}@example.hu`;
  const headers = { "x-dev-client-ip": `203.0.113.${(counter % 250) + 1}-${unique}` };
  await world.protectEmail(email);
  expect(
    (await request.post(urlFor("seeded", "/api/_dev/allowlist"), { data: { email } })).ok(),
  ).toBe(true);
  const requested = await request.post(urlFor("seeded", "/api/reports/code"), {
    data: { email },
    headers,
  });
  expect(requested.ok(), await requested.text()).toBe(true);
  const code = /\b(\d{6})\b/.exec((await waitForMails(world, email, 1)).at(-1)?.text ?? "")?.[1];
  const filed = await request.post(urlFor("seeded", "/api/reports/submit"), {
    headers,
    data: {
      email,
      code,
      credential: `cred${unique.replace(/[^A-Za-z0-9]/g, "")}abcdefghijklmnop`,
      category: "elevator",
      location: "stairwell",
      title: "Elakadt a lift e2e",
      description: "A lift megáll.",
      place: "B lépcsőház",
    },
  });
  expect(filed.ok()).toBe(true);
  // The Reporter's mail so far: the code, then the confirmation with the Status link
  await waitForMails(world, email, 2);
  const body = (await filed.json()) as { number: number; statusUrl: string };
  return { number: body.number, token: body.statusUrl.split("/").at(-1) as string, email };
}

async function asStaff(request: APIRequestContext, world: AsyncControl, login: string) {
  const { token } = await world.addStaff({ login, role: "admin" });
  return async (path: string, data: unknown) => {
    const response = await request.fetch(`${githubBase}/repos/local-org/reports${path}`, {
      method: "PATCH",
      data,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "e2e",
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  };
}

const lookup = (request: APIRequestContext, token: string) =>
  request.post(urlFor("seeded", "/api/status/lookup"), {
    data: { token },
    headers: { "x-dev-client-ip": `198.51.100.${Date.now()}-${token}` },
  });

test.describe("the webhook receiver", () => {
  test("each Major change puts exactly one email in the outbox, in Hungarian, and link-only changes none", async ({
    request,
    world,
  }) => {
    const { number, token, email } = await fileReport(request, world);
    const patch = await asStaff(request, world, "hook-staff-1");
    const category = "category:elevator";

    // Link-only: a Priority label, a title edit, an assignment
    await patch(`/issues/${number}`, { labels: [category, "status:new", "priority:high"] });
    await patch(`/issues/${number}`, { title: "Elakadt a nagy lift" });
    await patch(`/issues/${number}`, { assignees: ["hook-staff-1"] });
    // A notify Status, a close (the dashboard's: the Status label goes with it), a reopen with the initial Status
    await patch(`/issues/${number}`, { labels: [category, "status:in-progress"] });
    await waitForMails(world, email, 3);
    await patch(`/issues/${number}`, {
      state: "closed",
      state_reason: "not_planned",
      labels: [category],
    });
    await waitForMails(world, email, 4);
    await patch(`/issues/${number}`, { state: "open", labels: [category, "status:new"] });
    await waitForMails(world, email, 5);
    await world.flushWebhooks();

    const mails = (await world.outbox(email)).slice(2);
    expect(mails).toHaveLength(3);
    const base = `Bejelentés #${number} — „Elakadt a nagy lift” — `;
    expect(mails.map((mail) => mail.subject)).toEqual([
      `${base}új állapot: Folyamatban`,
      `${base}lezárva`,
      `${base}újranyitva`,
    ]);
    for (const mail of mails) {
      expect(mail.reply_to).toEqual(["gondnok@example.org"]);
      expect(mail.html).toBeNull();
      expect(mail.text).toContain(`/status/${token}`);
      expect(mail.text).toContain("Automatikus üzenet a Rózsa Társasház");
    }
    expect(mails[1]?.text).toContain("Indok: a bejelentéssel nem foglalkozunk");
    // Rendered text, for the reader of the test log
    for (const mail of mails) console.log(`--- ${mail.subject}\n${mail.text}\n`);
  });

  test("the dashboard's close-as-fixed and reopen each send exactly one email", async ({
    request,
    world,
  }) => {
    const { number, email } = await fileReport(request, world);
    const patch = await asStaff(request, world, "hook-staff-3");
    const category = "category:elevator";
    // The Detail view's writes (#28): one PATCH each, the Status label dropped on close, the Initial status on reopen
    await patch(`/issues/${number}`, {
      state: "closed",
      state_reason: "completed",
      labels: [category],
    });
    await waitForMails(world, email, 3);
    await patch(`/issues/${number}`, { state: "open", labels: [category, "status:new"] });
    await waitForMails(world, email, 4);
    await world.flushWebhooks();
    const mails = (await world.outbox(email)).slice(2);
    expect(mails.map((mail) => mail.subject.split(" — ").at(-1))).toEqual([
      "lezárva",
      "újranyitva",
    ]);
  });

  test("a redelivered delivery does not send twice", async ({ request, world }) => {
    const { number, email } = await fileReport(request, world);
    const patch = await asStaff(request, world, "hook-staff-2");
    await patch(`/issues/${number}`, { state: "closed" });
    await waitForMails(world, email, 3);
    const closed = (await world.webhookDeliveries()).find(
      (delivery) => delivery.issueNumber === number && delivery.action === "closed",
    );
    expect(closed).toBeDefined();
    await world.redeliverWebhook(closed?.id as string);
    await world.flushWebhooks();
    expect(await world.outbox(email)).toHaveLength(3);
  });

  test("deleting the issue on GitHub erases the Report: the Status link answers 404", async ({
    request,
    world,
  }) => {
    const { number, token, email } = await fileReport(request, world);
    expect((await lookup(request, token)).status()).toBe(200);
    await world.deleteReport(number);
    await world.flushWebhooks();
    expect((await lookup(request, token)).status()).toBe(404);
    // Nothing is mailed to the Reporter for the deletion
    expect(await world.outbox(email)).toHaveLength(2);
  });
});
