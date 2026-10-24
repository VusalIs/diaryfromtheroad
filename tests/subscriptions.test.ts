import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DomainCheck } from "../src/lib/email-checks.ts";
import {
  HOURLY_EMAIL_LIMIT,
  WEBHOOK_TOLERANCE,
  WELCOME_COOLDOWN,
  createResendSender,
  createToken,
  formSiteKey,
  handleResendWebhook,
  handleSubscribe,
  isTurnstileTestKey,
  messages,
  normalizeEmail,
  parseSender,
  signupProblems,
  subscriberNotification,
  unsubscribe,
  verifyTurnstile,
  type EmailMessage,
  type SendEmail,
  type SignupConfig,
} from "../src/lib/subscriptions.ts";
import { createDatabase } from "./helpers/database.ts";

const ORIGIN = "https://diary.test";
const SECRET = "turnstile-secret";
/** The export query from SUBSCRIPTIONS.md. */
const EXPORT_QUERY = `SELECT email, subscribed_at, 'https://diaryfromtheroad.com/unsubscribe/?token=' || unsubscribe_token AS unsubscribe_url
FROM subscribers WHERE status = 'active' ORDER BY subscribed_at`;

/** A Siteverify stand-in that passes tokens starting with "pass". */
function siteverify(calls: URLSearchParams[]): typeof fetch {
  return async (_url, init) => {
    const body = new URLSearchParams(String(init?.body));
    calls.push(body);
    return Response.json({
      success: body.get("response")?.startsWith("pass") ?? false,
      action: "subscribe",
    });
  };
}

function setup({
  failEmail = false,
  sendEmail,
  checkDomain,
}: {
  failEmail?: boolean;
  sendEmail?: SendEmail;
  checkDomain?: (domain: string) => Promise<DomainCheck>;
} = {}) {
  const db = createDatabase();
  const sent: EmailMessage[] = [];
  const verifications: URLSearchParams[] = [];
  const subscribed: string[] = [];
  let now = new Date("2026-10-23T10:00:00.000Z");

  const post = (
    fields: Record<string, string>,
    contentType = "application/x-www-form-urlencoded",
  ) =>
    handleSubscribe(
      new Request(`${ORIGIN}/api/subscribe/`, {
        method: "POST",
        headers: { "content-type": contentType },
        body: new URLSearchParams(fields).toString(),
      }),
      {
        db,
        sendEmail:
          sendEmail ??
          (async (message) => {
            if (failEmail) throw new Error("email service down");
            sent.push(message);
          }),
        origin: ORIGIN,
        siteName: "Diary From the Road",
        author: "Vusal Ismayilov",
        turnstileSecret: SECRET,
        fetch: siteverify(verifications),
        checkDomain,
        onSubscribed: (email) => subscribed.push(email),
        now,
      },
    );

  const signUp = (email: string) => post({ email, "cf-turnstile-response": "pass-token" });
  const unsubscribeLink = (message = sent.at(-1)) => {
    const match = message?.text.match(
      new RegExp(`^${ORIGIN}/unsubscribe/\\?token=([A-Za-z0-9_-]{43})$`, "m"),
    );
    assert.ok(match, "expected an unsubscribe link on its own line");
    return match[1] ?? "";
  };

  return {
    db,
    sent,
    verifications,
    subscribed,
    post,
    signUp,
    unsubscribeLink,
    rows: () => db.sqlite.prepare("SELECT * FROM subscribers ORDER BY id").all(),
    setStatus: (email: string, status: string) =>
      db.sqlite.prepare("UPDATE subscribers SET status = ? WHERE email = ?").run(status, email),
    // SQLite rows have a null prototype; copy them so deepEqual compares plain objects.
    exported: () =>
      db.sqlite
        .prepare(EXPORT_QUERY)
        .all()
        .map((row) => ({ ...row })),
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
    get now() {
      return now;
    },
  };
}

describe("normalizeEmail", () => {
  it("trims and lowercases a valid address", () => {
    assert.equal(
      normalizeEmail("  Reader.Name+travel@Example.COM "),
      "reader.name+travel@example.com",
    );
  });

  it("rejects invalid addresses", () => {
    for (const input of [
      "",
      "reader",
      "reader@",
      "@example.com",
      "reader@example",
      "two words@example.com",
      "reader@exa mple.com",
      "reader@@example.com",
      `${"a".repeat(250)}@example.com`,
      42,
      undefined,
    ]) {
      assert.equal(normalizeEmail(input), undefined, `${String(input)} should be rejected`);
    }
  });
});

describe("subscribing", () => {
  it("subscribes a valid address at once and sends one welcome email", async () => {
    const t = setup();
    const response = await t.signUp(" Reader@Example.com ");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, message: messages.accepted });
    const [row] = t.rows();
    assert.equal(t.rows().length, 1);
    assert.equal(row?.email, "reader@example.com");
    assert.equal(row?.status, "active");
    assert.equal(row?.subscribed_at, t.now.toISOString());
    assert.equal(row?.welcome_sent_at, t.now.toISOString());
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0]?.to, "reader@example.com");
    assert.equal(t.unsubscribeLink(), row?.unsubscribe_token);
    assert.deepEqual(t.subscribed, ["reader@example.com"]);

    assert.equal(t.verifications.length, 1);
    assert.equal(t.verifications[0]?.get("secret"), SECRET);
    assert.equal(t.verifications[0]?.get("response"), "pass-token");
  });

  it("rejects an invalid address without storing it or calling Turnstile", async () => {
    const t = setup();
    const response = await t.signUp("not-an-email");

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      message: messages.invalidEmail,
      field: "email",
    });
    assert.equal(t.rows().length, 0);
    assert.equal(t.sent.length, 0);
    assert.equal(t.verifications.length, 0);
  });

  it("rejects a failed or missing Turnstile check without storing anything", async () => {
    const t = setup();
    const failed = await t.post({ email: "reader@example.com", "cf-turnstile-response": "fail" });
    const missing = await t.post({ email: "reader@example.com" });

    assert.equal(failed.status, 403);
    assert.equal(missing.status, 403);
    assert.deepEqual(await failed.json(), { ok: false, message: messages.verificationFailed });
    assert.equal(t.verifications.length, 1, "an empty token is refused without calling Siteverify");
    assert.equal(t.rows().length, 0);
    assert.equal(t.sent.length, 0);
  });

  it("answers a duplicate sign-up like a new one, without a second row, email, or note", async () => {
    const t = setup();
    const first = await t.signUp("reader@example.com");
    const second = await t.signUp("READER@example.com ");

    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), await first.json());
    assert.equal(t.rows().length, 1);
    assert.equal(t.sent.length, 1);
    assert.deepEqual(t.subscribed, ["reader@example.com"]);
  });

  it("never emails an address that is already subscribed, even after the cooldown", async () => {
    const t = setup();
    await t.signUp("reader@example.com");
    t.advance(WELCOME_COOLDOWN + 1000);
    const response = await t.signUp("reader@example.com");

    assert.deepEqual(await response.json(), { ok: true, message: messages.accepted });
    assert.equal(t.sent.length, 1);
    assert.equal(t.rows()[0]?.status, "active");
  });

  it("refuses other content types and bodies over 4 KB", async () => {
    const t = setup();
    const json = await t.post({ email: "reader@example.com" }, "application/json");
    const large = await t.post({ email: "reader@example.com", padding: "x".repeat(5000) });

    assert.equal(json.status, 415);
    assert.equal(large.status, 413);
    assert.equal(t.rows().length, 0);
  });

  it("pauses sign-up once the hourly email limit is reached", async () => {
    const t = setup();
    for (let i = 0; i < HOURLY_EMAIL_LIMIT; i++) {
      assert.equal((await t.signUp(`reader${i}@example.com`)).status, 200);
    }
    const response = await t.signUp("one-more@example.com");

    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { ok: false, message: messages.busy });
    assert.equal(t.rows().length, HOURLY_EMAIL_LIMIT);
  });

  it("undoes a sign-up whose welcome email could not be sent", async (context) => {
    context.mock.method(console, "error", () => {});
    const t = setup({ failEmail: true });
    const response = await t.signUp("reader@example.com");

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { ok: false, message: messages.sendFailed });
    assert.equal(t.rows().length, 0);
    assert.deepEqual(t.subscribed, []);
  });

  it("welcomes back a reader who unsubscribed, but not within the hour of the last welcome", async () => {
    const t = setup();
    await t.signUp("reader@example.com");
    const token = t.unsubscribeLink();
    await unsubscribe(token, { db: t.db, now: t.now });

    await t.signUp("reader@example.com");
    assert.equal(t.rows()[0]?.status, "unsubscribed", "too soon after the last welcome email");
    assert.equal(t.sent.length, 1);

    t.advance(WELCOME_COOLDOWN + 1000);
    await t.signUp("reader@example.com");
    const [row] = t.rows();
    assert.equal(row?.status, "active");
    assert.equal(row?.unsubscribed_at, null);
    assert.equal(row?.subscribed_at, t.now.toISOString());
    assert.equal(t.sent.length, 2);
    assert.equal(t.unsubscribeLink(), token, "the unsubscribe link stays the same");
    assert.deepEqual(t.subscribed, ["reader@example.com", "reader@example.com"]);
  });

  it("restores an unsubscribed reader when their welcome back email fails", async (context) => {
    context.mock.method(console, "error", () => {});
    let fail = false;
    const sent: EmailMessage[] = [];
    const t = setup({
      sendEmail: async (message) => {
        if (fail) throw new Error("email service down");
        sent.push(message);
      },
    });
    await t.signUp("reader@example.com");
    await unsubscribe(t.unsubscribeLink(sent[0]), { db: t.db, now: t.now });
    const before = { ...t.rows()[0] };
    t.advance(WELCOME_COOLDOWN + 1000);
    fail = true;

    assert.equal((await t.signUp("reader@example.com")).status, 502);
    assert.deepEqual({ ...t.rows()[0] }, before);
  });

  it("never adds back an address that bounced or reported spam", async () => {
    const t = setup();
    for (const status of ["bounced", "complained"]) {
      const email = `${status}@example.com`;
      await t.signUp(email);
      t.setStatus(email, status);
    }
    t.advance(WELCOME_COOLDOWN + 1000);
    const responses = [
      await t.signUp("bounced@example.com"),
      await t.signUp("complained@example.com"),
    ];

    for (const response of responses) {
      assert.deepEqual(await response.json(), { ok: true, message: messages.accepted });
    }
    assert.deepEqual(
      t.rows().map((row) => row.status),
      ["bounced", "complained"],
    );
    assert.equal(t.sent.length, 2);
  });

  it("refuses throwaway inboxes before the spam check", async () => {
    const t = setup();
    const response = await t.signUp("someone@mailinator.com");

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      message: messages.disposableEmail,
      field: "email",
    });
    assert.equal(t.verifications.length, 0);
    assert.equal(t.rows().length, 0);
  });

  it("refuses domains that don't exist or take no email, after the spam check", async () => {
    const checked: string[] = [];
    const answers: Record<string, DomainCheck> = {
      "gone.test": "missing",
      "nomail.test": "no-mail",
      "example.com": "ok",
    };
    const t = setup({
      checkDomain: async (domain) => {
        checked.push(domain);
        return answers[domain] ?? "ok";
      },
    });

    const missing = await t.signUp("reader@gone.test");
    const noMail = await t.signUp("reader@nomail.test");
    const failedCheck = await t.post({
      email: "reader@gone.test",
      "cf-turnstile-response": "fail",
    });
    const ok = await t.signUp("reader@Example.com");

    assert.deepEqual(await missing.json(), {
      ok: false,
      message: messages.missingDomain,
      field: "email",
    });
    assert.deepEqual(await noMail.json(), {
      ok: false,
      message: messages.noMailDomain,
      field: "email",
    });
    assert.equal(failedCheck.status, 403);
    assert.equal(ok.status, 200);
    assert.deepEqual(checked, ["gone.test", "nomail.test", "example.com"]);
    assert.deepEqual(
      t.rows().map((row) => row.email),
      ["reader@example.com"],
    );
  });
});

describe("unsubscribing", () => {
  it("unsubscribes a reader and leaves them out of the export", async () => {
    const t = setup();
    await t.signUp("reader@example.com");
    assert.equal(t.exported().length, 1);

    assert.equal(await unsubscribe(t.unsubscribeLink(), { db: t.db, now: t.now }), "unsubscribed");
    const [row] = t.rows();
    assert.equal(row?.status, "unsubscribed");
    assert.equal(row?.unsubscribed_at, t.now.toISOString());
    assert.equal(t.exported().length, 0);
    assert.equal(await unsubscribe(t.unsubscribeLink(), { db: t.db, now: t.now }), "unsubscribed");
  });

  it("rejects malformed and unknown tokens", async () => {
    const t = setup();
    await t.signUp("reader@example.com");

    assert.equal(await unsubscribe("abc", { db: t.db }), "invalid");
    assert.equal(await unsubscribe(createToken(), { db: t.db }), "invalid");
    assert.equal(t.rows()[0]?.status, "active");
  });

  it("keeps a bounced address bounced when its link is used", async () => {
    const t = setup();
    await t.signUp("reader@example.com");
    t.setStatus("reader@example.com", "bounced");

    assert.equal(await unsubscribe(t.unsubscribeLink(), { db: t.db, now: t.now }), "unsubscribed");
    assert.equal(t.rows()[0]?.status, "bounced");
  });
});

describe("export query", () => {
  it("returns only active subscribers, with their unsubscribe links", async () => {
    const t = setup();
    for (const email of ["active@example.com", "left@example.com", "bounced@example.com"]) {
      await t.signUp(email);
    }
    const [active, left] = t.sent;
    await unsubscribe(t.unsubscribeLink(left), { db: t.db, now: t.now });
    t.setStatus("bounced@example.com", "bounced");

    assert.deepEqual(t.exported(), [
      {
        email: "active@example.com",
        subscribed_at: t.now.toISOString(),
        unsubscribe_url: `https://diaryfromtheroad.com/unsubscribe/?token=${t.unsubscribeLink(active)}`,
      },
    ]);
  });
});

describe("migration 0002", () => {
  it("keeps confirmed subscribers, drops unconfirmed sign-ups, and opens the new statuses", () => {
    const db = createDatabase({ upTo: 1 });
    const insert = db.sqlite.prepare(
      `INSERT INTO subscribers (email, status, created_at, confirmation_token_hash, confirmation_sent_at, confirmed_at, unsubscribe_token, unsubscribed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      "pending@example.com",
      "pending",
      "2026-10-20T00:00:00.000Z",
      "a".repeat(64),
      "2026-10-20T00:00:00.000Z",
      null,
      "t1",
      null,
    );
    insert.run(
      "active@example.com",
      "active",
      "2026-10-20T00:00:00.000Z",
      null,
      "2026-10-20T00:00:00.000Z",
      "2026-10-21T00:00:00.000Z",
      "t2",
      null,
    );
    insert.run(
      "left@example.com",
      "unsubscribed",
      "2026-10-20T00:00:00.000Z",
      null,
      "2026-10-20T00:00:00.000Z",
      "2026-10-21T00:00:00.000Z",
      "t3",
      "2026-10-22T00:00:00.000Z",
    );

    db.sqlite.exec(
      readFileSync(new URL("../migrations/0002_single_opt_in.sql", import.meta.url), "utf8"),
    );

    assert.deepEqual(
      db.sqlite
        .prepare(
          "SELECT email, status, subscribed_at, welcome_sent_at, unsubscribe_token, unsubscribed_at FROM subscribers ORDER BY id",
        )
        .all()
        .map((row) => ({ ...row })),
      [
        {
          email: "active@example.com",
          status: "active",
          subscribed_at: "2026-10-21T00:00:00.000Z",
          welcome_sent_at: "2026-10-20T00:00:00.000Z",
          unsubscribe_token: "t2",
          unsubscribed_at: null,
        },
        {
          email: "left@example.com",
          status: "unsubscribed",
          subscribed_at: "2026-10-21T00:00:00.000Z",
          welcome_sent_at: "2026-10-20T00:00:00.000Z",
          unsubscribe_token: "t3",
          unsubscribed_at: "2026-10-22T00:00:00.000Z",
        },
      ],
    );
    db.sqlite
      .prepare("UPDATE subscribers SET status = 'bounced' WHERE email = 'active@example.com'")
      .run();
    assert.throws(() =>
      db.sqlite
        .prepare("UPDATE subscribers SET status = 'pending' WHERE email = 'left@example.com'")
        .run(),
    );
  });
});

describe("verifyTurnstile", () => {
  const respond =
    (body: unknown, status = 200): typeof fetch =>
    async () =>
      Response.json(body, { status });

  it("accepts a successful check for the subscribe action", async () => {
    const options = { secret: SECRET, fetch: respond({ success: true, action: "subscribe" }) };
    assert.equal(await verifyTurnstile("token", options), true);
  });

  it("rejects failures, other actions, server errors, and network errors", async () => {
    const cases: (typeof fetch)[] = [
      respond({ success: false, "error-codes": ["invalid-input-response"] }),
      respond({ success: true, action: "login" }),
      respond({ success: true }, 500),
      async () => {
        throw new TypeError("network down");
      },
    ];
    for (const fetch of cases) {
      assert.equal(await verifyTurnstile("token", { secret: SECRET, fetch }), false);
    }
    assert.equal(
      await verifyTurnstile("x".repeat(2049), { secret: SECRET, fetch: cases[0] }),
      false,
    );
  });
});

describe("verifyTurnstile with a hostname", () => {
  const respond =
    (body: unknown): typeof fetch =>
    async () =>
      Response.json(body);
  const check = (body: unknown) =>
    verifyTurnstile("token", { secret: SECRET, hostname: "diary.test", fetch: respond(body) });

  it("accepts a challenge solved on the site's host and rejects any other", async () => {
    assert.equal(await check({ success: true, action: "subscribe", hostname: "diary.test" }), true);
    assert.equal(
      await check({ success: true, action: "subscribe", hostname: "other.test" }),
      false,
    );
    assert.equal(await check({ success: true, action: "subscribe" }), false);
  });

  it("requires the subscribe action, which only test keys leave empty", async () => {
    assert.equal(await check({ success: true, hostname: "diary.test" }), false);
    assert.equal(await check({ success: true, action: "login", hostname: "diary.test" }), false);
    assert.equal(
      await check({ success: false, action: "subscribe", hostname: "diary.test" }),
      false,
    );
  });
});

describe("configuration checks", () => {
  it("recognizes Cloudflare's Turnstile test keys", () => {
    for (const key of [
      "1x00000000000000000000AA",
      "2x00000000000000000000AB",
      "1x00000000000000000000BB",
      "2x00000000000000000000BB",
      "3x00000000000000000000FF",
      "1x0000000000000000000000000000000AA",
      "2x0000000000000000000000000000000AA",
      "3x0000000000000000000000000000000AA",
    ]) {
      assert.equal(isTurnstileTestKey(key), true, key);
    }
    assert.equal(isTurnstileTestKey("0x4AAAAAAAB1cdefGhIjKlMn"), false);
  });

  it("accepts one sender address with an optional plain name", () => {
    assert.equal(
      parseSender(" Diary From the Road <posts@diary.test> "),
      "Diary From the Road <posts@diary.test>",
    );
    assert.equal(parseSender("posts@diary.test"), "posts@diary.test");
    for (const value of [
      undefined,
      "",
      "Diary From the Road",
      "Diary <posts@diary>",
      "Diary, Road <posts@diary.test>",
      "posts@diary.test, other@diary.test",
      "posts@diary.test\r\nBcc: someone@else.test",
    ]) {
      assert.equal(parseSender(value), undefined, String(value));
    }
  });

  const ready: SignupConfig = {
    production: true,
    enabled: true,
    siteUrl: "https://diary.test",
    requestOrigin: "https://diary.test",
    hasDatabase: true,
    turnstileSecret: "0x4AAAAAAAB1cdefGhIjKlMnOpQrStUvWxYz",
    resendApiKey: "re_live_key",
    emailFrom: "Diary From the Road <posts@diary.test>",
  };

  it("opens production sign-up only when everything is configured", () => {
    assert.deepEqual(signupProblems(ready), []);
    const closed: [Partial<SignupConfig>, RegExp][] = [
      [{ enabled: false }, /subscriptions\.enabled/],
      [{ hasDatabase: false }, /SUBSCRIBERS_DB/],
      [{ turnstileSecret: undefined }, /TURNSTILE_SECRET_KEY secret is missing/],
      [{ turnstileSecret: "1x0000000000000000000000000000000AA" }, /test key/],
      [{ resendApiKey: undefined }, /RESEND_API_KEY secret is missing/],
      [{ resendApiKey: "not-a-resend-key" }, /not a Resend API key/],
      [{ emailFrom: undefined }, /EMAIL_FROM variable is missing/],
      [{ emailFrom: "posts at diary" }, /not a valid sender/],
      [{ siteUrl: "https://example.com", requestOrigin: "https://example.com" }, /placeholder/],
      [{ requestOrigin: "https://diaryfromtheroad.someone.workers.dev" }, /not siteUrl/],
    ];
    for (const [change, reason] of closed) {
      const problems = signupProblems({ ...ready, ...change });
      assert.ok(
        problems.some((problem) => reason.test(problem)),
        `${JSON.stringify(change)}: ${problems}`,
      );
    }
  });

  it("lets development run with only the database and a Turnstile secret", () => {
    const development = {
      ...ready,
      production: false,
      enabled: false,
      siteUrl: "https://example.com",
      requestOrigin: "http://localhost:4321",
      turnstileSecret: "1x0000000000000000000000000000000AA",
      resendApiKey: undefined,
      emailFrom: undefined,
    };
    assert.deepEqual(signupProblems(development), []);
    assert.ok(signupProblems({ ...development, hasDatabase: false }).length > 0);
  });

  it("renders the form in production builds only when enabled, and never with a test key", () => {
    const build = {
      siteKey: "0x4AAAAAAAB1cdefGhIjKlMn",
      production: true,
      enabled: true,
      siteUrl: "https://diary.test",
    };
    assert.equal(formSiteKey(build), build.siteKey);
    assert.equal(formSiteKey({ ...build, enabled: false }), undefined);
    assert.equal(formSiteKey({ ...build, siteKey: undefined }), undefined);
    assert.throws(() => formSiteKey({ ...build, siteKey: "1x00000000000000000000AA" }), /test key/);
    assert.throws(() => formSiteKey({ ...build, siteUrl: "https://example.com" }), /siteUrl/);
    assert.equal(
      formSiteKey({
        ...build,
        production: false,
        enabled: false,
        siteKey: "1x00000000000000000000AA",
      }),
      "1x00000000000000000000AA",
    );
  });
});

describe("sending with Resend", () => {
  const FROM = "Diary From the Road <posts@diary.test>";

  it("sends the welcome email and unsubscribe link through Resend's API", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const resend: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return Response.json({ id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" });
    };
    const t = setup({
      sendEmail: createResendSender({ apiKey: "re_test_key", from: FROM, fetch: resend }),
    });
    const response = await t.signUp("Reader@Example.com");

    assert.equal(response.status, 200);
    assert.equal(requests.length, 1);
    const [{ url, init }] = requests as [{ url: string; init: RequestInit }];
    const headers = new Headers(init.headers);
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init.method, "POST");
    assert.equal(headers.get("authorization"), "Bearer re_test_key");
    assert.equal(headers.get("content-type"), "application/json");

    const body = JSON.parse(String(init.body));
    const [row] = t.rows();
    const unsubscribeUrl = `${ORIGIN}/unsubscribe/?token=${row?.unsubscribe_token}`;
    assert.equal(body.from, FROM);
    assert.deepEqual(body.to, ["reader@example.com"]);
    assert.equal(body.subject, "You're on the list for the weekly map from Diary From the Road");
    assert.match(
      String(body.text),
      /Thanks for signing up for the weekly map from Diary From the Road\./,
    );
    assert.match(String(body.text), /If you didn't sign up, someone else entered your address\./);
    assert.ok(
      String(body.text).split("\n").includes(unsubscribeUrl),
      "the link is on its own line",
    );
    assert.match(
      String(body.text),
      /Vusal Ismayilov\nDiary From the Road, https:\/\/diary\.test\/$/,
    );
    assert.deepEqual(body.headers, {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("undoes the sign-up when Resend refuses the email, and logs no key or address", async (context) => {
    const logged = context.mock.method(console, "error", () => {});
    const refuse: typeof fetch = async () =>
      Response.json(
        {
          statusCode: 403,
          name: "validation_error",
          message: "The diary.test domain is not verified. Please, add and verify your domain.",
        },
        { status: 403 },
      );
    const t = setup({
      sendEmail: createResendSender({ apiKey: "re_secret_key", from: FROM, fetch: refuse }),
    });
    const response = await t.signUp("reader@example.com");

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { ok: false, message: messages.sendFailed });
    assert.equal(t.rows().length, 0);
    const log = logged.mock.calls.map((call) => call.arguments.join(" ")).join("\n");
    assert.match(log, /403 validation_error/);
    assert.doesNotMatch(log, /re_secret_key|reader@example\.com/);
  });

  it("undoes the sign-up when Resend can't be reached", async (context) => {
    context.mock.method(console, "error", () => {});
    const offline: typeof fetch = async () => {
      throw new TypeError("network down");
    };
    const t = setup({
      sendEmail: createResendSender({ apiKey: "re_test_key", from: FROM, fetch: offline }),
    });

    assert.equal((await t.signUp("reader@example.com")).status, 502);
    assert.equal(t.rows().length, 0);
  });
});

describe("new-subscriber notes", () => {
  it("writes a short note naming the subscriber and the active count", () => {
    const note = subscriberNotification({
      to: "hello@diary.test",
      siteName: "Diary From the Road",
      email: "reader@example.com",
      activeCount: 3,
    });
    assert.equal(note.to, "hello@diary.test");
    assert.equal(note.subject, "New subscriber: reader@example.com");
    assert.match(note.text, /reader@example\.com just subscribed to Diary From the Road\./);
    assert.match(note.text, /Active subscribers: 3/);
    assert.equal(note.unsubscribeUrl, undefined);
  });

  it("sends the note through Resend without unsubscribe headers", async () => {
    let body: Record<string, unknown> = {};
    const resend: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" });
    };
    const send = createResendSender({
      apiKey: "re_test_key",
      from: "Diary <hello@diary.test>",
      fetch: resend,
    });
    await send(
      subscriberNotification({
        to: "hello@diary.test",
        siteName: "Diary",
        email: "reader@example.com",
        activeCount: 1,
      }),
    );

    assert.deepEqual(body.to, ["hello@diary.test"]);
    assert.equal(body.subject, "New subscriber: reader@example.com");
    assert.equal("headers" in body, false);
  });
});

describe("Resend webhook", () => {
  const WEBHOOK_SECRET = `whsec_${Buffer.from("a webhook signing secret").toString("base64")}`;
  const sign = (id: string, timestamp: string, body: string, secret = WEBHOOK_SECRET) =>
    createHmac("sha256", Buffer.from(secret.slice("whsec_".length), "base64"))
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");

  async function deliver(
    t: ReturnType<typeof setup>,
    event: unknown,
    {
      signature,
      timestamp = String(Math.floor(t.now.getTime() / 1000)),
    }: { signature?: string; timestamp?: string } = {},
  ) {
    const body = JSON.stringify(event);
    const id = "msg_2LO1p1aZ0Zf0Q1o8YQ8c2Y2Q1Rk";
    return handleResendWebhook(
      new Request(`${ORIGIN}/api/resend-webhook/`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "svix-id": id,
          "svix-timestamp": timestamp,
          "svix-signature": signature ?? `v1,${sign(id, timestamp, body)}`,
        },
        body,
      }),
      { secret: WEBHOOK_SECRET, db: t.db, now: t.now },
    );
  }

  const bounced = (to: string, type = "Permanent") => ({
    type: "email.bounced",
    created_at: "2026-10-23T10:00:00.000Z",
    data: { email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", to: [to], bounce: { type } },
  });

  it("marks a permanently bounced address, which the form then won't add back", async (context) => {
    const logged = context.mock.method(console, "info", () => {});
    const t = setup();
    await t.signUp("reader@example.com");

    assert.equal((await deliver(t, bounced("Reader@Example.com"))).status, 204);
    const [row] = t.rows();
    assert.equal(row?.status, "bounced");
    assert.equal(row?.unsubscribed_at, t.now.toISOString());
    assert.equal(t.exported().length, 0);
    const log = logged.mock.calls.map((call) => call.arguments.join(" ")).join("\n");
    assert.match(log, /email\.bounced; 1 subscriber\(s\) marked bounced/);
    assert.doesNotMatch(log, /reader@example\.com/i);

    t.advance(WELCOME_COOLDOWN + 1000);
    await t.signUp("reader@example.com");
    assert.equal(t.rows()[0]?.status, "bounced");
    assert.equal(t.sent.length, 1);
  });

  it("marks a spam report, even from an address that had unsubscribed", async (context) => {
    context.mock.method(console, "info", () => {});
    const t = setup();
    await t.signUp("reader@example.com");
    await unsubscribe(t.unsubscribeLink(), { db: t.db, now: t.now });
    const unsubscribedAt = t.rows()[0]?.unsubscribed_at;
    t.advance(1000);

    const event = { type: "email.complained", data: { to: ["reader@example.com"] } };
    assert.equal((await deliver(t, event)).status, 204);
    assert.equal(t.rows()[0]?.status, "complained");
    assert.equal(t.rows()[0]?.unsubscribed_at, unsubscribedAt);
  });

  it("ignores temporary bounces and other events", async () => {
    const t = setup();
    await t.signUp("reader@example.com");

    assert.equal((await deliver(t, bounced("reader@example.com", "Transient"))).status, 204);
    const delivered = { type: "email.delivered", data: { to: ["reader@example.com"] } };
    assert.equal((await deliver(t, delivered)).status, 204);
    assert.equal(t.rows()[0]?.status, "active");
  });

  it("refuses unsigned, wrongly signed, and stale requests", async () => {
    const t = setup();
    await t.signUp("reader@example.com");
    const event = bounced("reader@example.com");
    const stale = String(Math.floor((t.now.getTime() - WEBHOOK_TOLERANCE - 1000) / 1000));
    const otherSecret = `whsec_${Buffer.from("someone else's secret").toString("base64")}`;

    for (const options of [
      { signature: "" },
      { signature: "v1,bm90IGEgc2lnbmF0dXJl" },
      { signature: `v1,${sign("msg_2LO1p1aZ0Zf0Q1o8YQ8c2Y2Q1Rk", "1", "{}", otherSecret)}` },
      { timestamp: stale },
      { timestamp: "not-a-number" },
    ]) {
      assert.equal((await deliver(t, event, options)).status, 401, JSON.stringify(options));
    }
    assert.equal(t.rows()[0]?.status, "active");
  });

  it("accepts a valid signature among several, as during a secret rotation", async (context) => {
    context.mock.method(console, "info", () => {});
    const t = setup();
    await t.signUp("reader@example.com");
    const event = bounced("reader@example.com");
    const timestamp = String(Math.floor(t.now.getTime() / 1000));
    const valid = sign("msg_2LO1p1aZ0Zf0Q1o8YQ8c2Y2Q1Rk", timestamp, JSON.stringify(event));

    const response = await deliver(t, event, {
      timestamp,
      signature: `v1,bm90IGEgc2lnbmF0dXJl v1,${valid}`,
    });
    assert.equal(response.status, 204);
    assert.equal(t.rows()[0]?.status, "bounced");
  });
});
