/**
 * Connects src/lib/subscriptions.ts to the Worker: the D1 binding, the Turnstile and Resend
 * secrets, the sender address, the address that hears about new subscribers, and the Resend
 * webhook's signing secret. Import it only from routes rendered on request
 * (`export const prerender = false`).
 */
import {
  EMAIL_FROM,
  NOTIFY_EMAIL,
  RESEND_API_KEY,
  RESEND_WEBHOOK_SECRET,
  TURNSTILE_SECRET_KEY,
} from "astro:env/server";
import { env } from "cloudflare:workers";
import { siteConfig } from "@/config/site";
import { checkMailDomain } from "@/lib/email-checks";
import {
  createResendSender,
  normalizeEmail,
  parseSender,
  signupProblems,
  subscriberNotification,
  type Database,
  type SendEmail,
} from "@/lib/subscriptions";

/** The SUBSCRIBERS_DB binding from wrangler.jsonc, if the Worker has it. */
export function getSubscribersDb(): Database | undefined {
  const db = env.SUBSCRIBERS_DB;
  const isDatabase =
    typeof db === "object" && db !== null && "prepare" in db && typeof db.prepare === "function";
  return isDatabase ? (db as Database) : undefined;
}

/** In development without Resend, emails are printed to the terminal instead of being sent. */
const printEmail: SendEmail = async ({ subject, text }) => {
  console.info(`[subscriptions] Development only, not sent:\n\n${subject}\n\n${text}\n`);
};

/** Resend when RESEND_API_KEY and EMAIL_FROM are set; in development without them, the terminal. */
function getEmailSender(): SendEmail | undefined {
  const from = parseSender(EMAIL_FROM);
  if (RESEND_API_KEY && from) return createResendSender({ apiKey: RESEND_API_KEY, from });
  return import.meta.env.DEV ? printEmail : undefined;
}

/**
 * Everything sign-up needs, or `undefined` while it is closed, with the reasons logged (never
 * the values). See `signupProblems` for what production requires.
 */
export function getSignupSetup(requestUrl: URL) {
  const db = getSubscribersDb();
  const production = !import.meta.env.DEV;
  const problems = signupProblems({
    production,
    enabled: siteConfig.subscriptions.enabled,
    siteUrl: siteConfig.siteUrl,
    requestOrigin: requestUrl.origin,
    hasDatabase: Boolean(db),
    turnstileSecret: TURNSTILE_SECRET_KEY,
    resendApiKey: RESEND_API_KEY,
    emailFrom: EMAIL_FROM,
  });
  const sendEmail = getEmailSender();
  if (!db || !TURNSTILE_SECRET_KEY || !sendEmail || problems.length > 0) {
    console.warn(`[subscriptions] Sign-up is closed: ${problems.join("; ") || "not configured"}.`);
    return undefined;
  }

  const site = new URL(siteConfig.siteUrl);
  return {
    db,
    sendEmail,
    siteName: siteConfig.name,
    author: siteConfig.author.name,
    checkDomain: (domain: string) => checkMailDomain(domain),
    turnstileSecret: TURNSTILE_SECRET_KEY,
    // Production only answers requests from siteUrl, so links and the Turnstile check use it.
    origin: production ? site.origin : requestUrl.origin,
    turnstileHostname: production ? site.hostname : undefined,
  };
}

/**
 * Emails NOTIFY_EMAIL when someone subscribes, with the number of active subscribers, or
 * `undefined` when NOTIFY_EMAIL isn't set. A failed note is only logged: the subscription itself
 * already stands.
 */
export function getOwnerNotifier(db: Database) {
  const to = normalizeEmail(NOTIFY_EMAIL);
  const send = getEmailSender();
  if (!to || !send) return undefined;
  return async (email: string) => {
    try {
      const active = await db
        .prepare("SELECT COUNT(*) AS count FROM subscribers WHERE status = 'active'")
        .first<{ count: number }>();
      await send(
        subscriberNotification({
          to,
          siteName: siteConfig.name,
          email,
          activeCount: active?.count ?? 0,
        }),
      );
    } catch (error) {
      console.error(
        `[subscriptions] The new-subscriber note wasn't sent: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  };
}

/**
 * What the Resend webhook needs, or `undefined` while it can't run: without RESEND_WEBHOOK_SECRET
 * no request could be verified, so none is trusted.
 */
export function getWebhookSetup() {
  const db = getSubscribersDb();
  if (!db || !RESEND_WEBHOOK_SECRET) {
    console.warn(
      `[subscriptions] The Resend webhook is off: ${!db ? "the SUBSCRIBERS_DB binding is missing" : "the RESEND_WEBHOOK_SECRET secret is missing"}.`,
    );
    return undefined;
  }
  return { db, secret: RESEND_WEBHOOK_SECRET };
}
