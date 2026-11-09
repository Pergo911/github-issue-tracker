import { referenceConfig } from "../src/shared/seed/reference-config.ts";
import { labelName, DIMENSIONS } from "../src/shared/config/schema.ts";
import { createClock, type Clock } from "./clock.ts";
import type {
  Control,
  FaultSpec,
  ReportSpec,
  StaffGrant,
  Violation,
  WorldSettings,
  WorldSummary,
} from "./control.ts";
import { DeviceFlow } from "./github/device-flow.ts";
import { errorBody, GitHubService, type BotApp } from "./github/routes.ts";
import { GitHubStore } from "./github/store.ts";
import { TokenRegistry } from "./github/tokens.ts";
import { WebhookHub, type WebhookTarget } from "./github/webhooks.ts";
import { jsonResponse, readFormOrJson } from "./http.ts";
import { ResendFake } from "./resend/resend.ts";

/** The fake dropped the connection before answering: Node's bridge destroys the socket, a stub rejects. */
export class ConnectionLost extends TypeError {
  constructor() {
    super("fetch failed: the connection was lost before the response arrived");
  }
}

export interface WorldOptions {
  org: string;
  repo: string;
  bot: BotApp & { accountId?: number };
  /** The staff app's client id: the device-flow endpoints refuse any other. */
  staffClientId?: string;
  verifiedDomains?: string[];
  webhook?: WebhookTarget | null;
  now?: () => number;
}

export interface World {
  /**
   * Answers any request under the world's prefixes: `/github` (api.github.com), `/github-web` (github.com's
   * device flow), `/resend` (api.resend.com) and `/control`. A fault can make it reject (a timeout, a lost
   * response), as a real `fetch` would.
   */
  handle(request: Request): Promise<Response>;
  readonly control: Control;
  readonly clock: Clock;
  readonly options: Readonly<Pick<WorldOptions, "org" | "repo" | "bot" | "staffClientId">>;
  /** Where `issues` webhooks go. Not part of `Control`: it is a function, set by whoever hosts the world. */
  setWebhookTarget(target: WebhookTarget | null): void;
}

interface ActiveFault {
  id: number;
  spec: FaultSpec;
  remaining: number | null;
  skip: number;
}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const entry of value) collectStrings(entry, into);
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      into.push(key);
      collectStrings(entry, into);
    }
  }
}

export function createWorld(options: WorldOptions): World {
  const clock = createClock(options.now);
  const botAccountId = options.bot.accountId ?? 100_000_000 + options.bot.appId;
  const store = new GitHubStore(
    {
      org: options.org,
      repo: options.repo,
      bot: { slug: options.bot.slug, accountId: botAccountId },
    },
    clock,
  );
  const tokens = new TokenRegistry(clock);
  let webhookTarget: WebhookTarget | null = options.webhook ?? null;
  const webhooks = new WebhookHub(() => webhookTarget);
  const staffClientId = options.staffClientId ?? "Iv1.fakestaffclient";
  let verifiedDomains = [...(options.verifiedDomains ?? [])];

  const github = new GitHubService({ store, tokens, webhooks, clock, bot: options.bot });
  const device = new DeviceFlow({
    clock,
    tokens,
    clientId: () => staffClientId,
  });
  const resend = new ResendFake({ clock, verifiedDomains: () => verifiedDomains });

  const faults: ActiveFault[] = [];
  let nextFaultId = 1;
  const protectedEmails = new Set<string>();
  let violations: Violation[] = [];

  // ----------------------------------------------------------------------------------- invariant

  interface LoggedWrite {
    method: string;
    path: string;
    /** Lower-cased body text plus every string in it (so JSON escapes are decoded). */
    body: string;
    /** Lower-cased, decoded path and query. */
    url: string;
  }
  const writeLog: LoggedWrite[] = [];
  const MAX_LOGGED_WRITES = 5000;

  function matchesAddress(write: LoggedWrite, address: string): Violation | null {
    if (write.body.includes(address)) {
      return { method: write.method, path: write.path, address, where: "body" };
    }
    if (write.url.includes(address)) {
      return { method: write.method, path: write.path, address, where: "url" };
    }
    return null;
  }

  /**
   * SPEC 4.1, 5: the Reporter's email is never written into GitHub. Every write is logged and scanned for the
   * addresses registered with `protectEmail`; an address registered later is checked against the log too, so
   * a test can register its Allowlist entries last.
   */
  async function checkWrite(request: Request, path: string): Promise<void> {
    if (!WRITE_METHODS.has(request.method)) return;
    const text = await request.clone().text();
    const strings: string[] = [];
    try {
      collectStrings(JSON.parse(text), strings);
    } catch {
      strings.push(text);
    }
    let url = path.toLowerCase();
    try {
      url = decodeURIComponent(url);
    } catch {
      // keep the raw path
    }
    url += `?${new URL(request.url).searchParams.toString()}`.toLowerCase();
    const write: LoggedWrite = {
      method: request.method,
      path,
      body: [text, ...strings].join(" | ").toLowerCase(),
      url,
    };
    writeLog.push(write);
    if (writeLog.length > MAX_LOGGED_WRITES) writeLog.shift();
    for (const address of protectedEmails) {
      const violation = matchesAddress(write, address);
      if (violation) violations.push(violation);
    }
  }

  // --------------------------------------------------------------------------------------- faults

  function takeFault(
    service: FaultSpec["service"],
    request: Request,
    path: string,
  ): FaultSpec["effect"] | null {
    for (const fault of faults) {
      const { spec } = fault;
      if (spec.service !== service) continue;
      if (spec.method && spec.method.toUpperCase() !== request.method) continue;
      if (spec.path && !new RegExp(spec.path).test(path)) continue;
      if (fault.skip > 0) {
        fault.skip -= 1;
        continue;
      }
      if (fault.remaining !== null) {
        fault.remaining -= 1;
        if (fault.remaining <= 0) faults.splice(faults.indexOf(fault), 1);
      }
      return spec.effect;
    }
    return null;
  }

  function defaultFaultBody(service: FaultSpec["service"], status: number): unknown {
    if (service === "github") return errorBody(status, "Server Error");
    if (service === "resend")
      return { statusCode: status, name: "application_error", message: "Server Error" };
    return { error: "server_error", error_description: "Server Error" };
  }

  async function hold(request: Request, holdMs: number): Promise<never> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, holdMs);
      request.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        },
        { once: true },
      );
    });
    throw new DOMException("The request timed out.", "TimeoutError");
  }

  // ------------------------------------------------------------------------------ the web service

  async function handleWeb(request: Request, path: string): Promise<Response> {
    const wantsJson = (request.headers.get("accept") ?? "").includes("json");
    const respond = (body: Record<string, unknown>): Response => {
      if (wantsJson) return jsonResponse(body);
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) form.set(key, String(value));
      return new Response(form.toString(), {
        headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      });
    };
    if (request.method !== "POST") return new Response("Not Found", { status: 404 });
    const params = await readFormOrJson(request);
    if (params === "invalid") return new Response("Bad Request", { status: 400 });
    if (path === "/login/device/code") return respond({ ...device.requestCode(params) });
    if (path === "/login/oauth/access_token") return respond({ ...device.token(params) });
    return new Response("Not Found", { status: 404 });
  }

  // ----------------------------------------------------------------------------------- the control

  function grants(): StaffGrant[] {
    return [...store.staff.values()].map(({ account, role }) => ({
      login: account.login,
      role,
      token: staticTokens.get(account.login) ?? "",
    }));
  }
  const staticTokens = new Map<string, string>();

  function addStaff(spec: { login: string; role: StaffGrant["role"] }): StaffGrant {
    store.addStaff(spec.login, spec.role);
    let token = staticTokens.get(spec.login);
    if (!token) {
      token = tokens.mintStatic(spec.login);
      staticTokens.set(spec.login, token);
    }
    return { login: spec.login, role: spec.role, token };
  }

  function createReport(spec: ReportSpec): { number: number; id: number } {
    const bot = store.actorForLogin(store.botAccount.login)!;
    const { issue, events } = store.createIssue(bot, {
      title: spec.title,
      body: spec.body ?? null,
      labels: spec.labels ?? [],
      assignees: [],
      isPullRequest: spec.pullRequest ?? false,
    });
    const all = [...events];
    if (spec.assignees?.length) {
      const maintainer = [...store.staff.values()].find((m) => m.role === "admin") ?? bot;
      const actor =
        "account" in maintainer ? { account: maintainer.account, role: maintainer.role } : bot;
      all.push(...store.updateIssue(actor, issue.number, { assignees: spec.assignees }).events);
    }
    for (const comment of spec.comments ?? []) {
      const author = comment.author ? store.accountByLogin(comment.author) : store.botAccount;
      if (!author) throw new Error(`Unknown comment author ${comment.author}`);
      store.createComment(author, issue.number, comment.body);
    }
    if (spec.state === "closed") {
      all.push(
        ...store.updateIssue(bot, issue.number, {
          state: "closed",
          state_reason: spec.stateReason ?? "completed",
        }).events,
      );
    }
    if (spec.webhooks) github.emitEvents(all);
    return { number: issue.number, id: issue.id };
  }

  const control: Control = {
    reset() {
      store.reset();
      tokens.clear();
      staticTokens.clear();
      device.reset();
      webhooks.clear();
      resend.reset();
      faults.length = 0;
      protectedEmails.clear();
      writeLog.length = 0;
      violations = [];
      clock.reset();
      verifiedDomains = [...(options.verifiedDomains ?? [])];
    },
    configure(update: WorldSettings) {
      if (update.unknownLabels) store.settings.unknownLabels = update.unknownLabels;
      if (update.triageCanLabel !== undefined)
        store.settings.triageCanLabel = update.triageCanLabel;
      if (update.strictPolling !== undefined) device.strictPolling = update.strictPolling;
      if (update.verifiedDomains) verifiedDomains = [...update.verifiedDomains];
    },
    summary(): WorldSummary {
      return {
        org: options.org,
        repo: options.repo,
        bot: {
          login: store.botAccount.login,
          accountId: botAccountId,
          appId: options.bot.appId,
          installationId: options.bot.installationId,
        },
        staff: grants(),
        issues: store.issues.size,
        labels: store.labels.size,
        mails: resend.outbox().length,
        openDeviceCodes: device.codes(),
        faults: faults.length,
        webhookTarget: webhookTarget?.url ?? null,
      };
    },

    addStaff,
    seed() {
      for (const dimension of DIMENSIONS) {
        for (const value of referenceConfig.taxonomy[dimension]) {
          const name = labelName(dimension, value.id);
          if (!store.label(name)) store.createLabel(name, value.color);
        }
      }
      const staff = [
        addStaff({ login: "vera-viewer", role: "read" }),
        addStaff({ login: "mate-maintenance", role: "triage" }),
        addStaff({ login: "adam-admin", role: "admin" }),
        addStaff({ login: "nora-outsider", role: "none" }),
      ];
      const reports = [
        createReport({
          title: "Csöpög a csap a 2. emeleti közös mosdóban",
          body: "A bal oldali csap folyamatosan csöpög, a mosdó alatt víz gyűlik.",
          labels: ["category:plumbing", "location:floor-2", "status:new"],
        }),
        createReport({
          title: "Nem működik a lépcsőházi világítás",
          body: "A harmadik és a negyedik szint között kiégett a lámpa.",
          labels: [
            "category:electrical",
            "location:stairwell",
            "priority:high",
            "status:in-progress",
          ],
          assignees: ["mate-maintenance"],
          comments: [{ body: "Megrendeltük az izzót, jövő héten cseréljük." }],
        }),
        createReport({
          title: "Beragadt a lift ajtaja",
          body: "A földszinten néha nem záródik be az ajtó.",
          labels: ["category:elevator", "location:elevator", "priority:urgent", "status:on-hold"],
        }),
        createReport({
          title: "Kiszakadt a garázskapu távirányítója",
          body: "A távirányító gombja beszorul.",
          labels: ["category:doors-windows", "location:garage"],
          state: "closed",
          stateReason: "completed",
        }),
      ].map((report) => report.number);
      return { staff, reports };
    },
    createReport,
    addComment(number, body, authorLogin) {
      const author = authorLogin ? store.accountByLogin(authorLogin) : store.botAccount;
      if (!author) throw new Error(`Unknown comment author ${authorLogin}`);
      return { id: store.createComment(author, number, body).id };
    },
    deleteReport(number) {
      const snapshot = store.snapshotIssue(number);
      const event = store.deleteIssue(store.botAccount, number);
      github.emitDeleted(event, snapshot);
    },

    deviceCodes: () => device.codes(),
    approveDeviceCode(userCode, login) {
      if (!store.staff.has(login))
        throw new Error(`No Staff user ${login}: add one with addStaff first`);
      device.approve(userCode, login);
    },
    denyDeviceCode: (userCode) => device.deny(userCode),
    expireDeviceCode: (userCode) => device.expire(userCode),
    scriptNextDevicePoll: (outcome) => device.scriptNextPoll(outcome),

    addFault(spec) {
      const id = nextFaultId++;
      faults.push({
        id,
        spec,
        remaining: spec.times === undefined ? 1 : spec.times,
        skip: spec.skip ?? 0,
      });
      return id;
    },
    clearFaults() {
      faults.length = 0;
    },

    holdWebhooks: () => webhooks.hold(),
    releaseWebhooks: (releaseOptions) => webhooks.release(releaseOptions),
    setWebhookDuplicates: (on) => webhooks.setDuplicates(on),
    flushWebhooks: () => webhooks.flush(),
    webhookDeliveries: () => webhooks.deliveries(),
    redeliverWebhook: (id) => webhooks.redeliver(id),

    outbox: (to) => resend.outbox(to),
    latestMailTo: (address) => resend.latestTo(address),
    clearOutbox: () => resend.clearOutbox(),
    setResendRateLimit: (perSecond) => resend.setRateLimit(perSecond),

    advanceClock: (milliseconds) => clock.advance(milliseconds),
    clockNow: () => clock.now(),

    protectEmail(address) {
      const normalised = address.trim().toLowerCase();
      if (protectedEmails.has(normalised)) return;
      protectedEmails.add(normalised);
      for (const write of writeLog) {
        const violation = matchesAddress(write, normalised);
        if (violation) violations.push(violation);
      }
    },
    takeViolations() {
      const taken = violations;
      violations = [];
      return taken;
    },
  };

  // -------------------------------------------------------------------------------------- routing

  async function handleControl(request: Request, path: string): Promise<Response> {
    const name = path.replace(/^\//, "");
    if (request.method === "GET" && name === "summary")
      return jsonResponse({ result: control.summary() });
    if (request.method !== "POST" || !Object.hasOwn(control, name)) {
      return jsonResponse({ error: `Unknown control method "${name}"` }, 404);
    }
    const text = await request.text();
    let args: unknown[];
    try {
      const parsed: unknown = text.trim() === "" ? [] : JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("the body must be the JSON array of arguments");
      args = parsed;
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    try {
      const method = (control as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!;
      const result = await method.apply(control, args);
      return jsonResponse({ result: result === undefined ? null : result });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  const PREFIXES = ["/github-web", "/github", "/resend", "/control"] as const;

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const prefix = PREFIXES.find(
      (candidate) => url.pathname === candidate || url.pathname.startsWith(`${candidate}/`),
    );
    if (!prefix) return jsonResponse({ error: "Not Found" }, 404);
    const path = url.pathname.slice(prefix.length) || "/";
    if (prefix === "/control") return handleControl(request, path);

    const service =
      prefix === "/github" ? "github" : prefix === "/github-web" ? "github-web" : "resend";
    if (service === "github") await checkWrite(request, path);

    const effect = takeFault(service, request, path);
    if (effect?.type === "timeout") {
      const key = service === "resend" ? request.headers.get("idempotency-key") : null;
      if (key) {
        // A held send is still in flight: a second one with the same key must get Resend's 409.
        let fingerprint = "";
        try {
          fingerprint = JSON.stringify(JSON.parse(await request.clone().text()));
        } catch {
          // not JSON: nothing to fingerprint
        }
        resend.markInFlight(key, fingerprint);
        try {
          return await hold(request, effect.holdMs ?? 60_000);
        } finally {
          resend.releaseInFlight(key);
        }
      }
      return hold(request, effect.holdMs ?? 60_000);
    }
    if (effect?.type === "status") {
      return jsonResponse(
        effect.body ?? defaultFaultBody(service, effect.status),
        effect.status,
        effect.headers,
      );
    }

    let response: Response;
    if (service === "github") response = await github.handle(request, path);
    else if (service === "github-web") response = await handleWeb(request, path);
    else response = await resend.handle(request, path);

    if (effect?.type === "lost-response") {
      await response.arrayBuffer();
      throw new ConnectionLost();
    }
    return response;
  }

  return {
    handle,
    control,
    clock,
    options: {
      org: options.org,
      repo: options.repo,
      bot: options.bot,
      ...(options.staffClientId ? { staffClientId: options.staffClientId } : {}),
    },
    setWebhookTarget(target) {
      webhookTarget = target;
    },
  };
}
