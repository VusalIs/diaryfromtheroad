import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONFIRMATION_COOLDOWN,
  CONFIRMATION_TTL,
  HOURLY_EMAIL_LIMIT,
  confirmSubscription,
  createResendSender,
  createToken,
  formSiteKey,
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
const EXPORT_QUERY = `SELECT email, confirmed_at, 'https://diaryfromtheroad.com/unsubscribe/?token=' || unsubscribe_token AS unsubscribe_url
FROM subscribers WHERE status = 'active' AND confirmed_at IS NOT NULL ORDER BY confirmed_at`;

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
}: { failEmail?: boolean; sendEmail?: SendEmail } = {}) {
  const db = createDatabase();
  const sent: EmailMessage[] = [];
  const verifications: URLSearchParams[] = [];
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
        turnstileSecret: SECRET,
        fetch: siteverify(verifications),
        now,
      },
    );

  const signUp = (email: string) => post({ email, "cf-turnstile-response": "pass-token" });
  const tokenIn = (message: EmailMessage | undefined, path: string) => {
    const match = message?.text.match(new RegExp(`${ORIGIN}${path}\\?token=([A-Za-z0-9_-]{43})`));
    assert.ok(match, `expected a ${path} link in the email`);
    return match[1];
  };

  return {
    db,
    sent,
    verifications,
    post,
    signUp,
    confirmLink: (message = sent.at(-1)) => tokenIn(message, "/subscribe/confirm/"),
    unsubscribeLink: (message = sent.at(-1)) => tokenIn(message, "/unsubscribe/"),
    rows: () => db.sqlite.prepare("SELECT * FROM subscribers ORDER BY id").all(),
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
  it("stores a valid address as pending and sends one confirmation email", async () => {
    const t = setup();
    const response = await t.signUp(" Reader@Example.com ");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, message: messages.accepted });
    const [row] = t.rows();
    assert.equal(t.rows().length, 1);
    assert.equal(row?.email, "reader@example.com");
    assert.equal(row?.status, "pending");
    assert.equal(row?.confirmed_at, null);
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0]?.to, "reader@example.com");

    const token = t.confirmLink();
    assert.notEqual(row?.confirmation_token_hash, token, "only a hash of the token is stored");
    assert.match(String(row?.confirmation_token_hash), /^[0-9a-f]{64}$/);
    assert.equal(t.unsubscribeLink(), row?.unsubscribe_token);

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

  it("answers a duplicate sign-up like a new one, without a second row or email", async () => {
    const t = setup();
    const first = await t.signUp("reader@example.com");
    const second = await t.signUp("READER@example.com ");

    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), await first.json());
    assert.equal(t.rows().length, 1);
    assert.equal(t.sent.length, 1);
  });

  it("sends a new link after the cooldown, and the old link stops working", async () => {
    const t = setup();
    await t.signUp("reader@example.com");
    const oldToken = t.confirmLink();
    t.advance(CONFIRMATION_COOLDOWN + 1000);
    await t.signUp("reader@example.com");

    assert.equal(t.sent.length, 2);
    assert.equal(await confirmSubscription(oldToken, { db: t.db, now: t.now }), "invalid");
    assert.equal(await confirmSubscription(t.confirmLink(), { db: t.db, now: t.now }), "confirmed");
  });

  it("does not email an address that is already subscribed", async () => {
    const t = setup();
    await t.signUp("reader@example.com");
    await confirmSubscription(t.confirmLink(), { db: t.db, now: t.now });
    t.advance(CONFIRMATION_COOLDOWN + 1000);
    const response = await t.signUp("reader@example.com");

    assert.equal(response.status, 200);
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

  it("rolls back a sign-up whose confirmation email could not be sent", async (context) => {
    context.mock.method(console, "error", () => {});
    const t = setup({ failEmail: true });
    const response = await t.signUp("reader@example.com");

    assert.equal(response.status, 502);
    assert.equal(t.rows().length, 0);
  });

  it("deletes unconfirmed addresses once their link has expired", async () => {
    const t = setup();
    await t.signUp("never-confirmed@example.com");
    t.advance(CONFIRMATION_TTL + 1000);
    await t.signUp("reader@example.com");

    assert.deepEqual(
      t.rows().map((row) => row.email),
      ["reader@example.com"],
    );
  });
});

describe("confirming", () => {
  it("activates the subscription, and each link works once", async () => {
    const t = setup();
    await t.signUp("reader@example.com");
    const token = t.confirmLink();

    assert.equal(await confirmSubscription(token, { db: t.db, now: t.now }), "confirmed");
    const [row] = t.rows();
    assert.equal(row?.status, "active");
    assert.equal(row?.confirmed_at, t.now.toISOString());
    assert.equal(row?.confirmation_token_hash, null);
    assert.equal(await confirmSubscription(token, { db: t.db, now: t.now }), "invalid");
  });

  it("rejects an expired link", async () => {
    const t = setup();
    await t.signUp("reader@example.com");
    t.advance(CONFIRMATION_TTL + 1000);

    assert.equal(await confirmSubscription(t.confirmLink(), { db: t.db, now: t.now }), "invalid");
    assert.equal(t.rows()[0]?.status, "pending");
  });

  it("rejects malformed and unknown tokens", async () => {
    const t = setup();
    await t.signUp("reader@example.com");

    assert.equal(await confirmSubscription("abc", { db: t.db }), "invalid");
    assert.equal(await confirmSubscription(createToken(), { db: t.db }), "invalid");
    assert.equal(t.rows()[0]?.status, "pending");
  });
});

describe("unsubscribing", () => {
  it("unsubscribes a confirmed subscriber and leaves them out of the export", async () => {
    const t = setup();
    await t.signUp("reader@example.com");
    await confirmSubscription(t.confirmLink(), { db: t.db, now: t.now });
    assert.equal(t.exported().length, 1);

    assert.equal(await unsubscribe(t.unsubscribeLink(), { db: t.db, now: t.now }), "unsubscribed");
    const [row] = t.rows();
    assert.equal(row?.status, "unsubscribed");
    assert.equal(row?.unsubscribed_at, t.now.toISOString());
    assert.equal(t.exported().length, 0);
    assert.equal(await unsubscribe(t.unsubscribeLink(), { db: t.db, now: t.now }), "unsubscribed");
  });

  it("deletes an address that was never confirmed", async () => {
    const t = setup();
    await t.signUp("reader@example.com");

    assert.equal(await unsubscribe(t.unsubscribeLink(), { db: t.db, now: t.now }), "unsubscribed");
    assert.equal(t.rows().length, 0);
  });

  it("rejects malformed and unknown tokens", async () => {
    const t = setup();
    await t.signUp("reader@example.com");

    assert.equal(await unsubscribe("abc", { db: t.db }), "invalid");
    assert.equal(await unsubscribe(createToken(), { db: t.db }), "invalid");
    assert.equal(t.rows().length, 1);
  });

  it("asks a returning reader to confirm again before they are exported", async () => {
    const t = setup();
    await t.signUp("reader@example.com");
    await confirmSubscription(t.confirmLink(), { db: t.db, now: t.now });
    await unsubscribe(t.unsubscribeLink(), { db: t.db, now: t.now });
    t.advance(CONFIRMATION_COOLDOWN + 1000);
    await t.signUp("reader@example.com");

    assert.equal(t.sent.length, 2);
    assert.equal(t.rows()[0]?.status, "pending");
    assert.equal(t.exported().length, 0);
    await confirmSubscription(t.confirmLink(), { db: t.db, now: t.now });
    assert.equal(t.exported().length, 1);
  });
});

describe("export query", () => {
  it("returns only confirmed, active subscribers with their unsubscribe links", async () => {
    const t = setup();
    for (const email of ["active@example.com", "pending@example.com", "left@example.com"]) {
      await t.signUp(email);
    }
    const [active, , left] = t.sent;
    await confirmSubscription(t.confirmLink(active), { db: t.db, now: t.now });
    await confirmSubscription(t.confirmLink(left), { db: t.db, now: t.now });
    await unsubscribe(t.unsubscribeLink(left), { db: t.db, now: t.now });

    assert.deepEqual(t.exported(), [
      {
        email: "active@example.com",
        confirmed_at: t.now.toISOString(),
        unsubscribe_url: `https://diaryfromtheroad.com/unsubscribe/?token=${t.unsubscribeLink(active)}`,
      },
    ]);
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

describe("sending with Resend", () => {
  const FROM = "Diary From the Road <posts@diary.test>";

  it("sends the confirmation and unsubscribe links through Resend's API", async () => {
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
    assert.equal(body.from, FROM);
    assert.deepEqual(body.to, ["reader@example.com"]);
    assert.equal(body.subject, "Confirm your subscription to Diary From the Road");
    assert.match(String(body.text), /the weekly map from Diary From the Road: one email a week/);
    assert.deepEqual(body.headers, {
      "List-Unsubscribe": `<${ORIGIN}/unsubscribe/?token=${row?.unsubscribe_token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    const link = String(body.text).match(
      /^https:\/\/diary\.test\/subscribe\/confirm\/\?token=([A-Za-z0-9_-]{43})$/m,
    );
    assert.ok(link, "the email holds the confirmation URL on its own line");
    assert.equal(await confirmSubscription(link[1] ?? "", { db: t.db, now: t.now }), "confirmed");
  });

  it("rolls back the sign-up when Resend refuses the email, and logs no key or address", async (context) => {
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

  it("rolls back the sign-up when Resend can't be reached", async (context) => {
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

describe("new-subscriber notes", () => {
  it("reports each confirmation once, with the address, and never a reused or expired link", async () => {
    const t = setup();
    await t.signUp("Reader@Example.com");
    const token = t.confirmLink();
    const confirmed: string[] = [];
    const onConfirmed = (email: string) => confirmed.push(email);

    assert.equal(
      await confirmSubscription(token, { db: t.db, now: t.now, onConfirmed }),
      "confirmed",
    );
    assert.equal(
      await confirmSubscription(token, { db: t.db, now: t.now, onConfirmed }),
      "invalid",
    );
    assert.equal(
      await confirmSubscription("abc", { db: t.db, now: t.now, onConfirmed }),
      "invalid",
    );
    assert.deepEqual(confirmed, ["reader@example.com"]);

    await t.signUp("late@example.com");
    t.advance(CONFIRMATION_TTL + 1000);
    assert.equal(
      await confirmSubscription(t.confirmLink(), { db: t.db, now: t.now, onConfirmed }),
      "invalid",
    );
    assert.deepEqual(confirmed, ["reader@example.com"]);
  });

  it("writes a short note naming the subscriber and the active count", () => {
    const note = subscriberNotification({
      to: "hello@diary.test",
      siteName: "Diary From the Road",
      email: "reader@example.com",
      activeCount: 3,
    });
    assert.equal(note.to, "hello@diary.test");
    assert.equal(note.subject, "New subscriber: reader@example.com");
    assert.match(
      note.text,
      /reader@example\.com just confirmed a subscription to Diary From the Road\./,
    );
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
