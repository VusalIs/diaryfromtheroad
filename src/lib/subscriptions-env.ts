/**
 * Connects src/lib/subscriptions.ts to the Worker: the D1 binding, the Turnstile and Resend
 * secrets, and the sender address. Import it only from routes rendered on request
 * (`export const prerender = false`).
 */
import { EMAIL_FROM, RESEND_API_KEY, TURNSTILE_SECRET_KEY } from "astro:env/server";
import { env } from "cloudflare:workers";
import { siteConfig } from "@/config/site";
import {
  createResendSender,
  parseSender,
  signupProblems,
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
  const from = parseSender(EMAIL_FROM);
  const sendEmail =
    RESEND_API_KEY && from
      ? createResendSender({ apiKey: RESEND_API_KEY, from })
      : production
        ? undefined
        : printEmail;
  if (!db || !TURNSTILE_SECRET_KEY || !sendEmail || problems.length > 0) {
    console.warn(`[subscriptions] Sign-up is closed: ${problems.join("; ") || "not configured"}.`);
    return undefined;
  }

  const site = new URL(siteConfig.siteUrl);
  return {
    db,
    sendEmail,
    turnstileSecret: TURNSTILE_SECRET_KEY,
    // Production only answers requests from siteUrl, so links and the Turnstile check use it.
    origin: production ? site.origin : requestUrl.origin,
    turnstileHostname: production ? site.hostname : undefined,
  };
}
