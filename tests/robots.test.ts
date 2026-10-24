import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { robotsTxt } from "../src/lib/robots.ts";

const SITE = "https://diaryfromtheroad.com";
const BLOCKED = "User-agent: *\nDisallow: /\n";

describe("robotsTxt", () => {
  it("lets crawlers in on the canonical domain and points them to the sitemap", () => {
    assert.equal(
      robotsTxt(new URL("https://diaryfromtheroad.com/robots.txt"), SITE),
      "User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://diaryfromtheroad.com/sitemap-index.xml\n",
    );
  });

  it("keeps the temporary workers.dev URL, preview URLs, and any other host out", () => {
    for (const host of [
      "https://diaryfromtheroad.someone.workers.dev",
      "https://abc123-diaryfromtheroad.someone.workers.dev",
      "https://www.diaryfromtheroad.com",
      "http://diaryfromtheroad.com",
      "https://diaryfromtheroad.com.attacker.test",
      "http://localhost:4321",
    ]) {
      assert.equal(robotsTxt(new URL("/robots.txt", host), SITE), BLOCKED, host);
    }
  });
});
