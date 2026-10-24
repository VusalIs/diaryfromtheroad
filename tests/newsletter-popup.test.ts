import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  POPUP_DELAY,
  POPUP_SCROLL_DELAY,
  POPUP_SNOOZE_DAYS,
  popupDue,
  popupSnoozed,
  rememberPopup,
} from "../src/lib/newsletter-popup.ts";

const NOW = new Date("2026-10-24T09:30:00Z");
const daysLater = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

describe("rememberPopup", () => {
  it("stores the outcome and the day, and no time", () => {
    assert.equal(rememberPopup("dismissed", NOW), '{"state":"dismissed","on":"2026-10-24"}');
    assert.equal(rememberPopup("signed-up", NOW), '{"state":"signed-up","on":"2026-10-24"}');
  });
});

describe("popupSnoozed", () => {
  it("lets the popup open when nothing is stored", () => {
    assert.equal(popupSnoozed(null, NOW), false);
  });

  it(`keeps it away for ${POPUP_SNOOZE_DAYS} days after it is closed`, () => {
    const stored = rememberPopup("dismissed", NOW);
    assert.equal(popupSnoozed(stored, NOW), true);
    assert.equal(popupSnoozed(stored, daysLater(POPUP_SNOOZE_DAYS - 1)), true);
    assert.equal(popupSnoozed(stored, daysLater(POPUP_SNOOZE_DAYS)), false);
  });

  it("keeps it away for good after a sign-up", () => {
    assert.equal(popupSnoozed(rememberPopup("signed-up", NOW), daysLater(3650)), true);
  });

  it("ignores values it can't read", () => {
    for (const stored of [
      "",
      "dismissed",
      "{",
      "null",
      "[]",
      '{"state":"dismissed"}',
      '{"state":"dismissed","on":"soon"}',
      '{"state":"other","on":"2026-10-24"}',
    ]) {
      assert.equal(popupSnoozed(stored, NOW), false, stored);
    }
  });
});

describe("popupDue", () => {
  const page = { scrollHeight: 4000, viewportHeight: 800 };

  it("waits for the delay on a page the reader hasn't scrolled", () => {
    assert.equal(popupDue({ ...page, seconds: POPUP_DELAY - 1, scrollTop: 0 }), false);
    assert.equal(popupDue({ ...page, seconds: POPUP_DELAY, scrollTop: 0 }), true);
  });

  it("opens sooner once the reader is halfway down a long page, but not right away", () => {
    assert.equal(popupDue({ ...page, seconds: POPUP_SCROLL_DELAY, scrollTop: 1600 }), true);
    assert.equal(popupDue({ ...page, seconds: POPUP_SCROLL_DELAY, scrollTop: 1500 }), false);
    assert.equal(popupDue({ ...page, seconds: POPUP_SCROLL_DELAY - 1, scrollTop: 3200 }), false);
  });

  it("doesn't count scrolling on a short page", () => {
    assert.equal(
      popupDue({
        seconds: POPUP_SCROLL_DELAY,
        scrollTop: 700,
        scrollHeight: 1500,
        viewportHeight: 800,
      }),
      false,
    );
  });
});
