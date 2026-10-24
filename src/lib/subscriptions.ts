/**
 * Email subscriptions with double opt-in, stored in Cloudflare D1 (see SUBSCRIPTIONS.md).
 *
 * Everything here takes its database, email sender, and clock as arguments and imports nothing
 * from Astro or Cloudflare, so the tests run it in Node against SQLite.
 * src/lib/subscriptions-env.ts connects it to the Worker's bindings.
 */
import { z } from "astro/zod";

/** The part of D1's `D1Database` binding used here. */
export interface Database {
  prepare(query: string): Statement;
}

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** The recipient's unsubscribe link, also sent as a `List-Unsubscribe` header. */
  unsubscribeUrl?: string;
}

export type SendEmail = (message: EmailMessage) => Promise<void>;

type Status = "pending" | "active" | "unsubscribed";

const HOUR = 60 * 60 * 1000;
/** How long a confirmation link works. Unconfirmed addresses are deleted after this. */
export const CONFIRMATION_TTL = 48 * HOUR;
/** An address gets at most one confirmation email per hour, however often it is submitted. */
export const CONFIRMATION_COOLDOWN = HOUR;
/** Confirmation emails sent per hour across the whole site before sign-up pauses. */
export const HOURLY_EMAIL_LIMIT = 30;
/** The widget's `action`, checked again on the server. */
export const TURNSTILE_ACTION = "subscribe";

const MAX_BODY_BYTES = 4096;
const MAX_TURNSTILE_TOKEN = 2048;
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RESEND_URL = "https://api.resend.com/emails";
/** The placeholder `siteUrl` (`https://example.com`), which keeps sign-up closed. */
const PLACEHOLDER_HOST = "example.com";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const emailSchema = z.email().max(254);

export const messages = {
  accepted:
    "Thanks. If this address isn't subscribed yet, you'll get an email with a link to confirm it.",
  invalidEmail: "Enter a valid email address.",
  verificationFailed: "The spam check didn't pass. Please try again.",
  badRequest: "That request couldn't be processed.",
  busy: "Too many sign-ups right now. Please try again in an hour.",
  sendFailed: "The confirmation email couldn't be sent. Please try again later.",
  closed: "Email sign-up isn't open yet.",
  error: "Something went wrong. Please try again later.",
} as const;

/** Trims and lowercases an address; `undefined` if it is not a valid one. */
export function normalizeEmail(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const email = input.trim().toLowerCase();
  return emailSchema.safeParse(email).success ? email : undefined;
}

/** 256 random bits, base64url-encoded: 43 characters. */
export function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/**
 * Sends email through Resend's HTTP API. Throws when Resend refuses the email or can't be
 * reached; the error names the status and Resend's error type, never the key or the address.
 */
export function createResendSender({
  apiKey,
  from,
  fetch: send = fetch,
  timeout = 10_000,
}: {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
  timeout?: number;
}): SendEmail {
  return async ({ to, subject, text, unsubscribeUrl }) => {
    const response = await send(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        // Lets mail apps show their own unsubscribe button, which posts to the same link.
        ...(unsubscribeUrl && {
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      const name =
        typeof body === "object" && body !== null && "name" in body && typeof body.name === "string"
          ? body.name
          : "unknown_error";
      throw new Error(`Resend refused the email: ${response.status} ${name}`);
    }
  };
}

export function confirmationEmail(
  to: string,
  siteName: string,
  confirmUrl: string,
  unsubscribeUrl: string,
): EmailMessage {
  return {
    to,
    subject: `Confirm your subscription to ${siteName}`,
    text: [
      `Someone, hopefully you, asked to get an email when a new post is published on ${siteName}.`,
      "",
      "Confirm your subscription (the link works for 48 hours):",
      confirmUrl,
      "",
      "If you didn't ask for this, ignore this email and you won't be subscribed.",
      "",
      `Unsubscribe at any time: ${unsubscribeUrl}`,
    ].join("\n"),
    unsubscribeUrl,
  };
}

interface SubscribeOptions {
  db: Database;
  sendEmail: SendEmail;
  /** The site's origin, for the links in the email. */
  origin: string;
  siteName: string;
  now?: Date;
}

/**
 * Records a sign-up as pending and sends the confirmation email. The result is the same whether
 * the address is new, pending, or already subscribed, so a response never reveals who is subscribed.
 */
export async function subscribe(
  email: string,
  { db, sendEmail, origin, siteName, now = new Date() }: SubscribeOptions,
): Promise<"accepted" | "busy" | "failed"> {
  const at = now.toISOString();
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  // Nobody confirmed these, so they are not kept once their link has expired.
  await db
    .prepare(
      "DELETE FROM subscribers WHERE status = 'pending' AND (confirmation_sent_at IS NULL OR confirmation_sent_at < ?)",
    )
    .bind(ago(CONFIRMATION_TTL))
    .run();

  const existing = await db
    .prepare(
      "SELECT status, confirmation_sent_at, unsubscribe_token FROM subscribers WHERE email = ?",
    )
    .bind(email)
    .first<{ status: Status; confirmation_sent_at: string | null; unsubscribe_token: string }>();
  if (existing?.status === "active") return "accepted";
  if (
    existing?.confirmation_sent_at &&
    existing.confirmation_sent_at > ago(CONFIRMATION_COOLDOWN)
  ) {
    return "accepted";
  }

  const recent = await db
    .prepare("SELECT COUNT(*) AS count FROM subscribers WHERE confirmation_sent_at > ?")
    .bind(ago(HOUR))
    .first<{ count: number }>();
  if ((recent?.count ?? 0) >= HOURLY_EMAIL_LIMIT) return "busy";

  const token = createToken();
  const tokenHash = await hashToken(token);
  let unsubscribeToken: string;
  let undo: Statement;
  if (existing) {
    const updated = await db
      .prepare(
        `UPDATE subscribers SET status = 'pending', confirmation_token_hash = ?, confirmation_sent_at = ?
         WHERE email = ? AND status = ? AND (confirmation_sent_at IS NULL OR confirmation_sent_at <= ?)`,
      )
      .bind(tokenHash, at, email, existing.status, ago(CONFIRMATION_COOLDOWN))
      .run();
    // A simultaneous request for the same address got there first and sent the email.
    if (updated.meta.changes === 0) return "accepted";
    unsubscribeToken = existing.unsubscribe_token;
    undo = db
      .prepare(
        "UPDATE subscribers SET status = ?, confirmation_token_hash = NULL, confirmation_sent_at = NULL WHERE confirmation_token_hash = ?",
      )
      .bind(existing.status, tokenHash);
  } else {
    unsubscribeToken = createToken();
    const inserted = await db
      .prepare(
        `INSERT INTO subscribers (email, status, created_at, confirmation_token_hash, confirmation_sent_at, unsubscribe_token)
         VALUES (?, 'pending', ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING`,
      )
      .bind(email, at, tokenHash, at, unsubscribeToken)
      .run();
    if (inserted.meta.changes === 0) return "accepted";
    undo = db.prepare("DELETE FROM subscribers WHERE confirmation_token_hash = ?").bind(tokenHash);
  }

  const confirmUrl = new URL(`/subscribe/confirm/?token=${token}`, origin).toString();
  const unsubscribeUrl = new URL(`/unsubscribe/?token=${unsubscribeToken}`, origin).toString();
  try {
    await sendEmail(confirmationEmail(email, siteName, confirmUrl, unsubscribeUrl));
  } catch (error) {
    // The link never arrived, so the sign-up is rolled back rather than kept unconfirmable.
    console.error(
      `[subscriptions] The confirmation email wasn't sent: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    await undo.run();
    return "failed";
  }
  return "accepted";
}

/**
 * Marks a pending sign-up as confirmed. Each link works once, within CONFIRMATION_TTL.
 * `onConfirmed` is called with the address once it is confirmed, never on a reused or expired link.
 */
export async function confirmSubscription(
  token: string,
  {
    db,
    now = new Date(),
    onConfirmed,
  }: { db: Database; now?: Date; onConfirmed?: (email: string) => void },
): Promise<"confirmed" | "invalid"> {
  if (!isToken(token)) return "invalid";
  const confirmed = await db
    .prepare(
      `UPDATE subscribers SET status = 'active', confirmed_at = ?, confirmation_token_hash = NULL, unsubscribed_at = NULL
       WHERE confirmation_token_hash = ? AND status = 'pending' AND confirmation_sent_at > ?
       RETURNING email`,
    )
    .bind(
      now.toISOString(),
      await hashToken(token),
      new Date(now.getTime() - CONFIRMATION_TTL).toISOString(),
    )
    .first<{ email: string }>();
  if (!confirmed) return "invalid";
  onConfirmed?.(confirmed.email);
  return "confirmed";
}

/** The note to the site's owner when someone confirms. */
export function subscriberNotification({
  to,
  siteName,
  email,
  activeCount,
}: {
  to: string;
  siteName: string;
  email: string;
  activeCount: number;
}): EmailMessage {
  return {
    to,
    subject: `New subscriber: ${email}`,
    text: [
      `${email} just confirmed a subscription to ${siteName}.`,
      "",
      `Active subscribers: ${activeCount}`,
      "",
      "The full list is in Cloudflare: Storage & databases > D1 > diary-subscribers.",
    ].join("\n"),
  };
}

/**
 * Unsubscribes the address the token belongs to. A subscriber who had confirmed is kept as
 * `unsubscribed`, so the export leaves them out; an address that was never confirmed is deleted.
 */
export async function unsubscribe(
  token: string,
  { db, now = new Date() }: { db: Database; now?: Date },
): Promise<"unsubscribed" | "invalid"> {
  if (!isToken(token)) return "invalid";
  const removed = await db
    .prepare(
      "DELETE FROM subscribers WHERE unsubscribe_token = ? AND status = 'pending' AND confirmed_at IS NULL",
    )
    .bind(token)
    .run();
  if (removed.meta.changes === 1) return "unsubscribed";
  await db
    .prepare(
      `UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ?, confirmation_token_hash = NULL
       WHERE unsubscribe_token = ? AND status != 'unsubscribed'`,
    )
    .bind(now.toISOString(), token)
    .run();
  const row = await db
    .prepare("SELECT 1 AS found FROM subscribers WHERE unsubscribe_token = ?")
    .bind(token)
    .first();
  return row ? "unsubscribed" : "invalid";
}

export function isFormRequest(request: Request): boolean {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return type === "application/x-www-form-urlencoded";
}

/**
 * Reads a URL-encoded form body of at most 4 KB. `undefined` for any other content type, or
 * for a larger body, which is not read past the limit.
 */
export async function readForm(request: Request): Promise<URLSearchParams | undefined> {
  if (!isFormRequest(request)) return undefined;
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return undefined;
  if (!request.body) return new URLSearchParams();

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
  return new URLSearchParams(text + decoder.decode());
}

/**
 * Validates a Turnstile token with Siteverify. Any failure, including a network error, is a no.
 * With `hostname`, the challenge must also have been solved on that host, for the `subscribe` action.
 */
export async function verifyTurnstile(
  token: string,
  {
    secret,
    hostname,
    remoteIp,
    fetch: send = fetch,
  }: { secret: string; hostname?: string; remoteIp?: string; fetch?: typeof fetch },
): Promise<boolean> {
  if (!token || token.length > MAX_TURNSTILE_TOKEN) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const response = await send(SITEVERIFY_URL, { method: "POST", body });
    if (!response.ok) return false;
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) return false;
    const checked = result as { success?: unknown; action?: unknown; hostname?: unknown };
    if (checked.success !== true) return false;
    // Production passes `hostname`: the token must come from this site's widget and action.
    if (hostname) return checked.hostname === hostname && checked.action === TURNSTILE_ACTION;
    // Cloudflare's test keys, used only in development, leave `action` empty.
    return !checked.action || checked.action === TURNSTILE_ACTION;
  } catch {
    return false;
  }
}

export function reply(status: number, message: string, field?: "email"): Response {
  return Response.json(
    { ok: status === 200, message, ...(field && { field }) },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export interface SubscribeRequestOptions extends SubscribeOptions {
  turnstileSecret: string;
  /** The host the Turnstile challenge must come from; production passes siteUrl's. */
  turnstileHostname?: string;
  remoteIp?: string;
  fetch?: typeof fetch;
}

/** Handles a POST from the subscribe form. Responses are JSON: `{ ok, message, field? }`. */
export async function handleSubscribe(
  request: Request,
  {
    turnstileSecret,
    turnstileHostname,
    remoteIp,
    fetch: send,
    ...options
  }: SubscribeRequestOptions,
): Promise<Response> {
  if (!isFormRequest(request)) return reply(415, messages.badRequest);
  const form = await readForm(request);
  if (!form) return reply(413, messages.badRequest);

  const email = normalizeEmail(form.get("email"));
  if (!email) return reply(400, messages.invalidEmail, "email");

  const human = await verifyTurnstile(form.get("cf-turnstile-response") ?? "", {
    secret: turnstileSecret,
    hostname: turnstileHostname,
    remoteIp,
    fetch: send,
  });
  if (!human) return reply(403, messages.verificationFailed);

  try {
    const outcome = await subscribe(email, options);
    if (outcome === "busy") return reply(429, messages.busy);
    if (outcome === "failed") return reply(502, messages.sendFailed);
    return reply(200, messages.accepted);
  } catch {
    return reply(500, messages.error);
  }
}

/** Cloudflare's published Turnstile test site keys and secret keys, which always pass or fail. */
export function isTurnstileTestKey(key: string): boolean {
  return /^[123]x0+[A-F]{2}$/.test(key);
}

/**
 * Checks a sender such as `Diary From the Road <posts@example.com>` or `posts@example.com`, and
 * returns it trimmed. `undefined` unless it is one valid address with an optional plain name.
 */
export function parseSender(value: string | undefined): string | undefined {
  const sender = value?.trim() ?? "";
  const match = sender.match(/^(?:[^<>",\r\n]*<([^<>\s]+)>|([^<>\s]+))$/);
  const address = match?.[1] ?? match?.[2];
  return address && normalizeEmail(address) ? sender : undefined;
}

export interface SignupConfig {
  production: boolean;
  /** `subscriptions.enabled` in src/config/site.ts. */
  enabled: boolean;
  siteUrl: string;
  requestOrigin: string;
  hasDatabase: boolean;
  turnstileSecret?: string;
  resendApiKey?: string;
  emailFrom?: string;
}

/**
 * What keeps sign-up closed, as lines for the log; empty when it can open. Development needs the
 * database and a Turnstile secret, and prints emails unless Resend is set up. Production also needs
 * `subscriptions.enabled`, a real Turnstile secret, Resend, a valid sender, and requests from
 * `siteUrl`, so the links in emails always point at the site itself.
 */
export function signupProblems(config: SignupConfig): string[] {
  const { turnstileSecret, resendApiKey, emailFrom } = config;
  const problems: string[] = [];
  if (!config.hasDatabase) problems.push("the SUBSCRIBERS_DB binding is missing");
  if (!turnstileSecret) problems.push("the TURNSTILE_SECRET_KEY secret is missing");
  if (resendApiKey && !resendApiKey.startsWith("re_")) {
    problems.push("RESEND_API_KEY is not a Resend API key");
  }
  if (emailFrom && !parseSender(emailFrom)) problems.push("EMAIL_FROM is not a valid sender");
  if (!config.production) return problems;

  if (!config.enabled) problems.push("subscriptions.enabled is false in src/config/site.ts");
  if (turnstileSecret && isTurnstileTestKey(turnstileSecret)) {
    problems.push("TURNSTILE_SECRET_KEY is a Cloudflare test key");
  }
  if (!resendApiKey) problems.push("the RESEND_API_KEY secret is missing");
  if (!emailFrom) problems.push("the EMAIL_FROM variable is missing");
  const site = new URL(config.siteUrl);
  if (site.hostname === PLACEHOLDER_HOST) problems.push("siteUrl is still the placeholder");
  else if (config.requestOrigin !== site.origin) {
    problems.push(`the request came from ${config.requestOrigin}, not siteUrl (${site.origin})`);
  }
  return problems;
}

/**
 * The Turnstile site key for the subscribe form, or `undefined` to leave the form out.
 * Development shows the form whenever a key is set. Production builds show it only once
 * `subscriptions.enabled` is true, and fail rather than ship a test key or the placeholder siteUrl.
 */
export function formSiteKey({
  siteKey,
  production,
  enabled,
  siteUrl,
}: {
  siteKey: string | undefined;
  production: boolean;
  enabled: boolean;
  siteUrl: string;
}): string | undefined {
  if (!siteKey) return undefined;
  if (!production) return siteKey;
  if (!enabled) return undefined;
  if (isTurnstileTestKey(siteKey)) {
    throw new Error(
      "PUBLIC_TURNSTILE_SITE_KEY is a Cloudflare test key; production builds need the widget's real site key. See SUBSCRIPTIONS.md.",
    );
  }
  if (new URL(siteUrl).hostname === PLACEHOLDER_HOST) {
    throw new Error(
      "Set siteUrl in src/config/site.ts to the production domain before enabling subscriptions. See SUBSCRIPTIONS.md.",
    );
  }
  return siteKey;
}
