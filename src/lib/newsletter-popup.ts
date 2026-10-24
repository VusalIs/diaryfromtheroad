/**
 * When the weekly-map popup may open (see SUBSCRIPTIONS.md). The browser remembers one small value
 * in localStorage under `POPUP_STORAGE_KEY`: whether the reader closed the popup or signed up, and
 * the date. Nothing about it leaves the browser.
 */

export const POPUP_STORAGE_KEY = "diary-newsletter";
/** Set in sessionStorage once the popup has opened, so it opens at most once per visit. */
export const POPUP_SESSION_KEY = "diary-newsletter-shown";
/** How long closing the popup keeps it away. Signing up keeps it away for good. */
export const POPUP_SNOOZE_DAYS = 30;
/** Seconds the page has been visible before the popup opens anyway. */
export const POPUP_DELAY = 40;
/** The earliest the popup opens, in visible seconds, on a reader who scrolls well into a long page. */
export const POPUP_SCROLL_DELAY = 15;
/** How far down a long page, as a share of what can be scrolled, counts as well into it. */
export const POPUP_SCROLL_DEPTH = 0.5;

const DAY = 24 * 60 * 60 * 1000;

export type PopupOutcome = "dismissed" | "signed-up";

/** The value stored when the popup is closed or someone signs up: the outcome and the day only. */
export function rememberPopup(outcome: PopupOutcome, now: Date): string {
  return JSON.stringify({ state: outcome, on: now.toISOString().slice(0, 10) });
}

/** Whether a stored value still keeps the popup away. Anything unreadable counts as nothing stored. */
export function popupSnoozed(stored: string | null, now: Date): boolean {
  if (!stored) return false;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return false;
  }
  if (typeof value !== "object" || value === null) return false;
  const { state, on } = value as { state?: unknown; on?: unknown };
  if (state === "signed-up") return true;
  if (state !== "dismissed" || typeof on !== "string") return false;
  const day = Date.parse(`${on}T00:00:00Z`);
  if (Number.isNaN(day)) return false;
  return now.getTime() - day < POPUP_SNOOZE_DAYS * DAY;
}

/**
 * Whether the reader has spent long enough on the page: `POPUP_DELAY` visible seconds, or
 * `POPUP_SCROLL_DELAY` seconds on a page at least two screens tall that they have scrolled past
 * `POPUP_SCROLL_DEPTH` of.
 */
export function popupDue({
  seconds,
  scrollTop,
  scrollHeight,
  viewportHeight,
}: {
  seconds: number;
  scrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
}): boolean {
  if (seconds >= POPUP_DELAY) return true;
  if (seconds < POPUP_SCROLL_DELAY || scrollHeight < viewportHeight * 2) return false;
  return scrollTop / (scrollHeight - viewportHeight) >= POPUP_SCROLL_DEPTH;
}
