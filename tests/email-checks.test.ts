import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkMailDomain, isDisposableEmail, suggestEmail } from "../src/lib/email-checks.ts";

describe("suggestEmail", () => {
  it("fixes likely typos in common providers, keeping the name as typed", () => {
    for (const [typed, fixed] of [
      ["reader@gmial.com", "reader@gmail.com"],
      ["reader@gmail.con", "reader@gmail.com"],
      ["Reader.Name@GMAI.COM", "Reader.Name@gmail.com"],
      ["reader@hotmial.com", "reader@hotmail.com"],
      ["reader@yaho.com", "reader@yahoo.com"],
      ["reader@outlok.com", "reader@outlook.com"],
      ["reader@icloud.co", "reader@icloud.com"],
      ["reader@protonmail.co", "reader@protonmail.com"],
    ]) {
      assert.equal(suggestEmail(typed!), fixed, typed);
    }
  });

  it("leaves correct and unrelated addresses alone", () => {
    for (const email of [
      "reader@gmail.com",
      "reader@yahoo.co.uk",
      "reader@proton.me",
      "hello@diaryfromtheroad.com",
      "reader@company.vn",
      "reader@",
      "not an address",
    ]) {
      assert.equal(suggestEmail(email), undefined, email);
    }
  });
});

describe("isDisposableEmail", () => {
  it("recognizes throwaway inboxes and their subdomains", () => {
    assert.equal(isDisposableEmail("someone@mailinator.com"), true);
    assert.equal(isDisposableEmail("someone@inbox.mailinator.com"), true);
    assert.equal(isDisposableEmail("someone@yopmail.com"), true);
  });

  it("allows ordinary providers and alias services people keep", () => {
    for (const email of [
      "reader@gmail.com",
      "someone@notmailinator.com",
      "abc123@privaterelay.appleid.com",
      "alias@duck.com",
      "alias@mozmail.com",
    ]) {
      assert.equal(isDisposableEmail(email), false, email);
    }
  });
});

describe("checkMailDomain", () => {
  /** A DNS-over-HTTPS stand-in answering from a table of `type name` keys. */
  const resolver =
    (answers: Record<string, { Status: number; Answer?: unknown[] }>, seen: string[] = []) =>
    async (url: string | URL | Request) => {
      const query = new URL(String(url)).searchParams;
      const key = `${query.get("type")} ${query.get("name")}`;
      seen.push(key);
      const answer = answers[key];
      return answer ? Response.json(answer) : Response.json({ Status: 0 });
    };

  it("accepts a domain with mail servers", async () => {
    const seen: string[] = [];
    const fetch = resolver(
      { "MX example.com": { Status: 0, Answer: [{ type: 15, data: "10 mx.example.com." }] } },
      seen,
    );
    assert.equal(await checkMailDomain("example.com", { fetch }), "ok");
    assert.deepEqual(seen, ["MX example.com"]);
  });

  it("reports a domain that doesn't exist", async () => {
    const fetch = resolver({ "MX gone.test": { Status: 3 } });
    assert.equal(await checkMailDomain("gone.test", { fetch }), "missing");
  });

  it("reports a domain that declares it takes no email", async () => {
    const fetch = resolver({
      "MX nomail.test": { Status: 0, Answer: [{ type: 15, data: "0 ." }] },
    });
    assert.equal(await checkMailDomain("nomail.test", { fetch }), "no-mail");
  });

  it("falls back to the domain's own address when it has no mail servers", async () => {
    const withAddress = resolver({
      "MX bare.test": { Status: 0 },
      "A bare.test": { Status: 0, Answer: [{ type: 1, data: "192.0.2.1" }] },
    });
    const nothing = resolver({ "MX empty.test": { Status: 0 }, "A empty.test": { Status: 0 } });
    assert.equal(await checkMailDomain("bare.test", { fetch: withAddress }), "ok");
    assert.equal(await checkMailDomain("empty.test", { fetch: nothing }), "no-mail");
  });

  it("never blocks a reader when the lookup itself fails", async () => {
    const cases: (typeof fetch)[] = [
      async () => {
        throw new TypeError("network down");
      },
      async () => new Response("busy", { status: 503 }),
      async () => Response.json({ Status: 2 }),
      async () => new Response("not json"),
    ];
    for (const fetch of cases) {
      assert.equal(await checkMailDomain("example.com", { fetch }), "ok");
    }
  });
});
