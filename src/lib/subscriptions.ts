/**
 * Email subscriptions with single opt-in, stored in Cloudflare D1 (see SUBSCRIPTIONS.md): an
 * address is subscribed as soon as it is entered, and gets a welcome email with a link to leave.
 *
 * Everything here takes its database, email sender, and clock as arguments and imports nothing
 * from Astro or Cloudflare, so the tests run it in Node against SQLite.
 * src/lib/subscriptions-env.ts connects it to the Worker's bindings.
 */
import { z } from "astro/zod";
import { isDisposableEmail, type DomainCheck } from "./email-checks.ts";

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

type Status = "active" | "unsubscribed" | "bounced" | "complained";

const HOUR = 60 * 60 * 1000;
/** An address gets at most one welcome email per hour, however often it is submitted. */
export const WELCOME_COOLDOWN = HOUR;
/** Welcome emails sent per hour across the whole site before sign-up pauses. */
export const HOURLY_EMAIL_LIMIT = 30;
/** How old a webhook's timestamp may be before the request is treated as a replay. */
export const WEBHOOK_TOLERANCE = 5 * 60 * 1000;
/** The widget's `action`, checked again on the server. */
export const TURNSTILE_ACTION = "subscribe";

const MAX_BODY_BYTES = 4096;
const MAX_WEBHOOK_BYTES = 64 * 1024;
const MAX_TURNSTILE_TOKEN = 2048;
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RESEND_URL = "https://api.resend.com/emails";
/** The placeholder `siteUrl` (`https://example.com`), which keeps sign-up closed. */
const PLACEHOLDER_HOST = "example.com";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const emailSchema = z.email().max(254);

export const messages = {
  accepted: "You're on the list. If you weren't already, a welcome email is on its way.",
  invalidEmail: "Enter a valid email address.",
  disposableEmail: "Please use an address you'll keep. Temporary inboxes stop working too soon.",
  missingDomain: "That email domain doesn't seem to exist. Check the address for typos.",
  noMailDomain: "That domain can't receive email. Check the address for typos.",
  verificationFailed: "The spam check didn't pass. Please try again.",
  badRequest: "That request couldn't be processed.",
  busy: "Too many sign-ups right now. Please try again in an hour.",
  sendFailed: "The welcome email couldn't be sent. Please try again later.",
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

export function welcomeEmail({
  to,
  siteName,
  author,
  origin,
  unsubscribeUrl,
}: {
  to: string;
  siteName: string;
  /** Signs the email. */
  author: string;
  origin: string;
  unsubscribeUrl: string;
}): EmailMessage {
  return {
    to,
    subject: `You're on the list for the weekly map from ${siteName}`,
    text: [
      `Thanks for signing up for the weekly map from ${siteName}.`,
      "",
      "Once a week I'll send a Google Maps list of places I've found on the road: viewpoints, cafés that are good for working, cheap local food, and things worth a detour. The first one comes with the next weekly email.",
      "",
      "If you didn't sign up, someone else entered your address. Open this link and you won't get any more emails:",
      unsubscribeUrl,
      "",
      author,
      `${siteName}, ${new URL("/", origin).toString()}`,
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
  /** Signs the welcome email. */
  author: string;
  now?: Date;
  /** Called with the address once it has joined the list and its welcome email has gone out. */
  onSubscribed?: (email: string) => void;
}

/**
 * Adds the address to the list and sends the welcome email. The result is the same whether the
 * address is new or already subscribed, so a response never reveals who is subscribed. An address
 * that unsubscribed can sign up again; one that bounced or reported spam is never added back.
 */
export async function subscribe(
  email: string,
  { db, sendEmail, origin, siteName, author, now = new Date(), onSubscribed }: SubscribeOptions,
): Promise<"accepted" | "busy" | "failed"> {
  const at = now.toISOString();
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  const existing = await db
    .prepare(
      "SELECT status, subscribed_at, welcome_sent_at, unsubscribe_token, unsubscribed_at FROM subscribers WHERE email = ?",
    )
    .bind(email)
    .first<{
      status: Status;
      subscribed_at: string;
      welcome_sent_at: string | null;
      unsubscribe_token: string;
      unsubscribed_at: string | null;
    }>();
  if (existing && existing.status !== "unsubscribed") return "accepted";
  if (existing?.welcome_sent_at && existing.welcome_sent_at > ago(WELCOME_COOLDOWN)) {
    return "accepted";
  }

  const recent = await db
    .prepare("SELECT COUNT(*) AS count FROM subscribers WHERE welcome_sent_at > ?")
    .bind(ago(HOUR))
    .first<{ count: number }>();
  if ((recent?.count ?? 0) >= HOURLY_EMAIL_LIMIT) return "busy";

  let unsubscribeToken: string;
  let undo: Statement;
  if (existing) {
    const updated = await db
      .prepare(
        `UPDATE subscribers SET status = 'active', subscribed_at = ?, welcome_sent_at = ?, unsubscribed_at = NULL
         WHERE email = ? AND status = 'unsubscribed' AND (welcome_sent_at IS NULL OR welcome_sent_at <= ?)`,
      )
      .bind(at, at, email, ago(WELCOME_COOLDOWN))
      .run();
    // A simultaneous request for the same address got there first and sent the email.
    if (updated.meta.changes === 0) return "accepted";
    unsubscribeToken = existing.unsubscribe_token;
    undo = db
      .prepare(
        "UPDATE subscribers SET status = 'unsubscribed', subscribed_at = ?, welcome_sent_at = ?, unsubscribed_at = ? WHERE email = ?",
      )
      .bind(existing.subscribed_at, existing.welcome_sent_at, existing.unsubscribed_at, email);
  } else {
    unsubscribeToken = createToken();
    const inserted = await db
      .prepare(
        `INSERT INTO subscribers (email, status, created_at, subscribed_at, welcome_sent_at, unsubscribe_token)
         VALUES (?, 'active', ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING`,
      )
      .bind(email, at, at, at, unsubscribeToken)
      .run();
    if (inserted.meta.changes === 0) return "accepted";
    undo = db.prepare("DELETE FROM subscribers WHERE unsubscribe_token = ?").bind(unsubscribeToken);
  }

  const unsubscribeUrl = new URL(`/unsubscribe/?token=${unsubscribeToken}`, origin).toString();
  try {
    await sendEmail(welcomeEmail({ to: email, siteName, author, origin, unsubscribeUrl }));
  } catch (error) {
    // Resend refusing the email is the first sign of a bad address, so the sign-up is undone.
    console.error(
      `[subscriptions] The welcome email wasn't sent: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    await undo.run();
    return "failed";
  }
  onSubscribed?.(email);
  return "accepted";
}

/** The note to the site's owner when someone subscribes. */
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
      `${email} just subscribed to ${siteName}.`,
      "",
      `Active subscribers: ${activeCount}`,
      "",
      "The full list is in Cloudflare: Storage & databases > D1 > diary-subscribers.",
    ].join("\n"),
  };
}

/**
 * Unsubscribes the address the token belongs to. It stays on the list as `unsubscribed`, so the
 * export leaves it out and it isn't emailed again by mistake.
 */
export async function unsubscribe(
  token: string,
  { db, now = new Date() }: { db: Database; now?: Date },
): Promise<"unsubscribed" | "invalid"> {
  if (!isToken(token)) return "invalid";
  await db
    .prepare(
      "UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE unsubscribe_token = ? AND status = 'active'",
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
  const text = await readText(request, MAX_BODY_BYTES);
  return text === undefined ? undefined : new URLSearchParams(text);
}

/** Reads a request body as text, or `undefined` if it is larger than `limit` bytes. */
async function readText(request: Request, limit: number): Promise<string | undefined> {
  if (Number(request.headers.get("content-length")) > limit) return undefined;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Validates a Turnstile token with Siteverify. Any failure, including a network error, is a no,
 * and is logged with Cloudflare's error codes or the mismatch, never the token or the secret.
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
  const refuse = (reason: string) => {
    console.warn(`[subscriptions] Turnstile refused the sign-up: ${reason}`);
    return false;
  };
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const response = await send(SITEVERIFY_URL, { method: "POST", body });
    if (!response.ok) return refuse(`Siteverify answered ${response.status}`);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) return refuse("unreadable Siteverify reply");
    const checked = result as {
      success?: unknown;
      action?: unknown;
      hostname?: unknown;
      "error-codes"?: unknown;
    };
    if (checked.success !== true) {
      const codes = Array.isArray(checked["error-codes"]) ? checked["error-codes"].join(", ") : "";
      return refuse(`error codes [${codes || "none"}]`);
    }
    // Production passes `hostname`: the token must come from this site's widget and action.
    if (hostname) {
      if (checked.hostname !== hostname) {
        return refuse(`solved on ${String(checked.hostname)}, not ${hostname}`);
      }
      if (checked.action !== TURNSTILE_ACTION) {
        return refuse(`action "${String(checked.action)}", not "${TURNSTILE_ACTION}"`);
      }
      return true;
    }
    // Cloudflare's test keys, used only in development, leave `action` empty.
    if (checked.action && checked.action !== TURNSTILE_ACTION) {
      return refuse(`action "${String(checked.action)}", not "${TURNSTILE_ACTION}"`);
    }
    return true;
  } catch (error) {
    return refuse(`Siteverify unreachable (${error instanceof Error ? error.name : "error"})`);
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
  /** Checks that the address's domain can receive email (`checkMailDomain`); skipped if absent. */
  checkDomain?: (domain: string) => Promise<DomainCheck>;
}

/** Handles a POST from the subscribe form. Responses are JSON: `{ ok, message, field? }`. */
export async function handleSubscribe(
  request: Request,
  {
    turnstileSecret,
    turnstileHostname,
    remoteIp,
    fetch: send,
    checkDomain,
    ...options
  }: SubscribeRequestOptions,
): Promise<Response> {
  if (!isFormRequest(request)) return reply(415, messages.badRequest);
  const form = await readForm(request);
  if (!form) return reply(413, messages.badRequest);

  const email = normalizeEmail(form.get("email"));
  if (!email) return reply(400, messages.invalidEmail, "email");
  if (isDisposableEmail(email)) return reply(400, messages.disposableEmail, "email");

  const human = await verifyTurnstile(form.get("cf-turnstile-response") ?? "", {
    secret: turnstileSecret,
    hostname: turnstileHostname,
    remoteIp,
    fetch: send,
  });
  if (!human) return reply(403, messages.verificationFailed);

  // Only after Turnstile, so the endpoint can't be used to look up domains for free.
  const domain = await checkDomain?.(email.slice(email.lastIndexOf("@") + 1));
  if (domain === "missing") return reply(400, messages.missingDomain, "email");
  if (domain === "no-mail") return reply(400, messages.noMailDomain, "email");

  try {
    const outcome = await subscribe(email, options);
    if (outcome === "busy") return reply(429, messages.busy);
    if (outcome === "failed") return reply(502, messages.sendFailed);
    return reply(200, messages.accepted);
  } catch {
    return reply(500, messages.error);
  }
}

/**
 * Checks a webhook's Svix signature, which Resend uses: an HMAC-SHA256 of `id.timestamp.body`
 * with the base64 part of the `whsec_` secret, sent as space-separated `v1,<base64>` values.
 * Timestamps older or newer than WEBHOOK_TOLERANCE are refused, so a captured request can't be replayed.
 */
export async function verifyWebhookSignature(
  {
    id,
    timestamp,
    signature,
    body,
  }: { id: string; timestamp: string; signature: string; body: string },
  { secret, now = new Date() }: { secret: string; now?: Date },
): Promise<boolean> {
  if (!id || !/^\d+$/.test(timestamp) || !signature) return false;
  if (Math.abs(now.getTime() - Number(timestamp) * 1000) > WEBHOOK_TOLERANCE) return false;
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (char) => char.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    return version === "v1" && value !== undefined && sameString(value, expected);
  });
}

/** Compares two strings in time that depends only on their length. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/**
 * Handles Resend's webhook. A permanent bounce marks the address `bounced` and a spam report marks
 * it `complained`: neither is emailed again, and the form won't add them back. Other events are
 * acknowledged and ignored. Logs say what happened, never the addresses.
 */
export async function handleResendWebhook(
  request: Request,
  { secret, db, now = new Date() }: { secret: string; db: Database; now?: Date },
): Promise<Response> {
  const body = await readText(request, MAX_WEBHOOK_BYTES);
  if (body === undefined) return new Response(null, { status: 413 });
  const verified = await verifyWebhookSignature(
    {
      id: request.headers.get("svix-id") ?? "",
      timestamp: request.headers.get("svix-timestamp") ?? "",
      signature: request.headers.get("svix-signature") ?? "",
      body,
    },
    { secret, now },
  );
  if (!verified) return new Response(null, { status: 401 });

  let event: { type?: unknown; data?: { to?: unknown; bounce?: { type?: unknown } } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  const status =
    event.type === "email.complained"
      ? "complained"
      : event.type === "email.bounced" && (event.data?.bounce?.type ?? "Permanent") === "Permanent"
        ? "bounced"
        : undefined;
  if (!status) return new Response(null, { status: 204 });

  const recipients = Array.isArray(event.data?.to) ? event.data.to : [];
  let removed = 0;
  for (const recipient of recipients) {
    const email = normalizeEmail(recipient);
    if (!email) continue;
    const result = await db
      .prepare(
        `UPDATE subscribers SET status = ?, unsubscribed_at = COALESCE(unsubscribed_at, ?)
         WHERE email = ? AND status IN ('active', 'unsubscribed')`,
      )
      .bind(status, now.toISOString(), email)
      .run();
    removed += result.meta.changes;
  }
  console.info(
    `[subscriptions] Resend reported ${String(event.type)}; ${removed} subscriber(s) marked ${status}.`,
  );
  return new Response(null, { status: 204 });
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
