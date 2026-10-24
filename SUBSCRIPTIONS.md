# Email Subscriptions

Readers can sign up for **the weekly map**: one email a week with a Google Maps list of places worth finding where you are travelling (viewpoints, cafés to work from, cheap local food, detours). Addresses are stored in a Cloudflare D1 database that only you can read, with **single opt-in**: an address is subscribed as soon as it is entered, and gets a welcome email from [Resend](https://resend.com/) with a link to leave. There are no campaigns and nothing else is sent automatically; each week you export the list and send the email yourself.

The forms promise exactly that, so keep to it: one email a week, a Google Maps list, free, and a way to unsubscribe in every email. If what you send changes, change the copy too: the popup ([src/components/chrome/NewsletterPopup.astro](./src/components/chrome/NewsletterPopup.astro)), the end-of-post form ([src/components/blog/SubscribeForm.astro](./src/components/blog/SubscribeForm.astro)), the welcome email (`welcomeEmail` in [src/lib/subscriptions.ts](./src/lib/subscriptions.ts)), the unsubscribe page, and [the privacy notice](./src/pages/privacy.astro).

**Status: sign-up is on.** `subscriptions.enabled` in [src/config/site.ts](./src/config/site.ts) is `true`, and the domain, Resend, Turnstile, the secrets, and the D1 database (`diaryfromtheroad.com`, `diary-subscribers`) are set up. Set `enabled` back to `false` and deploy to close it: production builds then leave the forms out and the endpoint answers "Email sign-up isn't open yet" without storing anything.

## Why single opt-in

Until 2026-10-24 the list used double opt-in: nobody was subscribed until they clicked a link in a confirmation email. That proves consent best, but readers who miss or ignore the email are lost. Single opt-in keeps them, and the safeguards below keep the list clean instead: Turnstile against bots, a check that the address can receive email, no throwaway inboxes, a welcome email that lets someone whose address was entered by somebody else leave at once, and automatic removal of addresses that bounce or report spam. The copy says plainly that signing up subscribes you straight away.

## How it works

| Piece                                 | Where                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| End-of-post, home, and About forms    | [src/components/blog/SubscribeForm.astro](./src/components/blog/SubscribeForm.astro)                                                                                                                                |
| Popup                                 | [src/components/chrome/NewsletterPopup.astro](./src/components/chrome/NewsletterPopup.astro)                                                                                                                        |
| Field, button, typo hint, script      | [src/components/blog/SubscribeFields.astro](./src/components/blog/SubscribeFields.astro)                                                                                                                            |
| When the popup opens                  | [src/lib/newsletter-popup.ts](./src/lib/newsletter-popup.ts)                                                                                                                                                        |
| Typos, throwaway inboxes, DNS check   | [src/lib/email-checks.ts](./src/lib/email-checks.ts)                                                                                                                                                                |
| `POST /api/subscribe/`                | [src/pages/api/subscribe.ts](./src/pages/api/subscribe.ts)                                                                                                                                                          |
| `POST /api/resend-webhook/`           | [src/pages/api/resend-webhook.ts](./src/pages/api/resend-webhook.ts)                                                                                                                                                |
| `/unsubscribe/`                       | [src/pages/unsubscribe.astro](./src/pages/unsubscribe.astro)                                                                                                                                                        |
| `/privacy/`                           | [src/pages/privacy.astro](./src/pages/privacy.astro)                                                                                                                                                                |
| Logic, Resend, webhook, config checks | [src/lib/subscriptions.ts](./src/lib/subscriptions.ts)                                                                                                                                                              |
| Bindings and secrets                  | [src/lib/subscriptions-env.ts](./src/lib/subscriptions-env.ts)                                                                                                                                                      |
| Database schema                       | [migrations/](./migrations/): `0001` created the table, `0002` switched it to single opt-in                                                                                                                         |
| Tests                                 | [tests/subscriptions.test.ts](./tests/subscriptions.test.ts), [tests/email-checks.test.ts](./tests/email-checks.test.ts), and [tests/newsletter-popup.test.ts](./tests/newsletter-popup.test.ts), run by `npm test` |

1. **The forms.** One sits at the end of every article, after the share row and before Previous and Next, and at the bottom of the home page and the About page. The other is a popup that can open on other pages too (below). Both use the same field, button, and script ([SubscribeFields.astro](./src/components/blog/SubscribeFields.astro)) and post to the same endpoint. The end-of-post form is hidden without JavaScript, which the spam check needs, and Cloudflare's Turnstile script loads only when someone focuses an email field. When the reader leaves the field, a likely typo in a big provider (`gmial.com`, `gmail.con`) gets a "Did you mean …?" suggestion they can take with one click; nothing is changed for them. Both forms link to the privacy notice at `/privacy/`.
2. **Sign-up** posts the address and a Turnstile token to `/api/subscribe/`. The server validates and normalizes the address (trimmed, lowercased, at most 254 characters) and turns away throwaway inbox services, then checks the token with Turnstile's Siteverify. Only then does it look up the address's domain in DNS, through Cloudflare's DNS-over-HTTPS resolver: a domain that doesn't exist, or has neither mail servers nor an address, is refused with a hint to check for typos. A failed lookup never blocks anyone. Then the address is stored as `active` and the welcome email goes out through Resend's HTTP API. The reply is the same whether the address is new or already on the list, so it never reveals who is subscribed. If Resend refuses the welcome email or can't be reached, the sign-up is undone.
3. **The welcome email** thanks the reader, says what the weekly map is, and says that if they didn't sign up, the link below removes them. It carries the unsubscribe link in its text and in `List-Unsubscribe` headers.
4. **Unsubscribing** opens `/unsubscribe/?token=…`, which shows a button, so mail scanners that follow links can't unsubscribe anyone. Mail apps' own unsubscribe buttons post to the same link. The address is kept as `unsubscribed`, so exports leave it out. It can sign up again later and gets a new welcome email, at most one per hour.
5. **Bounces and spam reports** come back from Resend as webhooks to `/api/resend-webhook/` (set up below). A permanent bounce marks the address `bounced`; a spam report marks it `complained`. Neither is exported again, and the form won't add them back.

### The popup

A native modal `<dialog>` with the weekly-map offer and the sign-up form. It is on every indexable page except `/privacy/` and `/contact/`; pages marked `noindex` (the 404 and unsubscribe pages, and Apps or Tags while they are empty) never have it.

- **When it opens:** after 40 seconds of the page being visible, or after 15 seconds on a page at least two screens tall that the reader has scrolled more than halfway down. Time in a background tab doesn't count. It waits while another dialog (search, sharing, the image viewer) or the mobile menu is open, while the reader is typing or selecting text, and while another sign-up form is on screen.
- **How often:** at most once per visit (a flag in `sessionStorage`). Closing it keeps it away for 30 days; signing up, in the popup or another form, keeps it away for good. Both are remembered in `localStorage` under `diary-newsletter`, as the outcome and the date only, for example `{"state":"dismissed","on":"2026-10-24"}`. If the browser blocks storage, the popup never opens, since it couldn't remember being closed. Nothing about it is sent to the server.
- **Closing it:** the close button, Escape, or a click on the backdrop. The rest of the page is inert while it is open, scrolling is locked, and focus returns to where it was.
- **Signing up:** the same request and replies as the other forms. The popup shows "Thanks for signing up." only after the server accepts the address, with the server's own reply and a reminder to check the spam folder; errors stay in the form so the reader can try again.
- **The photo** (`src/assets/hero-road.jpg`) shows beside the text on screens at least 56rem wide. It is lazy-loaded, so it is only downloaded when the popup opens on a wide screen.

The timings live in [src/lib/newsletter-popup.ts](./src/lib/newsletter-popup.ts). To keep only the end-of-post and About forms, set `subscriptions.popup` to `false` in [src/config/site.ts](./src/config/site.ts). The popup follows `subscriptions.enabled` like the other forms: a production build without sign-up has none of them.

### What is stored

One row per address in the `subscribers` table: the address, its status (`active`, `unsubscribed`, `bounced`, or `complained`), when it was first added, when it last became active, when the last welcome email went out, when it left the list, and a random unsubscribe token. Nothing else: no name, no IP address, no browser details. The visitor's IP address goes to Turnstile's Siteverify with the token and is not kept. The domain part of the address goes to Cloudflare's DNS resolver for the lookup. Resend receives the address and the emails it delivers.

### New-subscriber notes

When someone joins the list, or comes back after unsubscribing, the site emails `NOTIFY_EMAIL` (set in `wrangler.jsonc` `vars`, now `hello@diaryfromtheroad.com`, which Cloudflare Email Routing forwards to your inbox): "New subscriber: name@example.com", with the number of active subscribers. It goes out through Resend after the reader already has their reply, so a failed note is only logged and never affects the subscription. A repeated sign-up of an address already on the list sends no note. Set `NOTIFY_EMAIL` to `""` to turn the notes off.

## When sign-up opens

In production, sign-up opens only when all of these hold. If any is missing, the endpoint answers 503 without storing anything and logs which ones, by name and never by value (`npx wrangler tail` shows the log):

- `subscriptions.enabled` is `true` in [src/config/site.ts](./src/config/site.ts).
- `siteUrl` (`https://diaryfromtheroad.com`) is not the `example.com` placeholder, and the request came from it, so the domain has to be connected first. Sign-ups from any other address, such as a `*.workers.dev` or preview URL, are refused, so the links in emails always point at `siteUrl`, and the Turnstile challenge must have been solved on that host.
- The Worker has the `SUBSCRIBERS_DB` binding.
- The `TURNSTILE_SECRET_KEY` secret is set and isn't one of Cloudflare's test keys.
- The `RESEND_API_KEY` secret is set and looks like a Resend key (`re_…`).
- The `EMAIL_FROM` variable is one valid sender, such as `Diary From the Road <posts@your-domain>`.

The bounce and spam-report webhook is separate: it answers 503 until the `RESEND_WEBHOOK_SECRET` secret is set, and sign-up works without it.

The forms appear in a production build only when `subscriptions.enabled` is `true` and the build has a Turnstile site key. The site's real key is the default for `PUBLIC_TURNSTILE_SITE_KEY` in [astro.config.mjs](./astro.config.mjs); it is public, so it lives in the code, and an environment variable of the same name overrides it. A build with sign-up enabled fails if that key is a Cloudflare test key or `siteUrl` is still the placeholder.

**What the code can't check is that the sender's domain is verified in Resend.** A sending-only Resend API key, the right kind for this, can't read domain status. That is why `subscriptions.enabled` is a switch you turn on yourself after checking. If the domain isn't verified, Resend refuses every email with `403 validation_error`, each sign-up is undone with "The welcome email couldn't be sent", and the log says so.

In development (`npm run dev`), `subscriptions.enabled` is ignored: sign-up needs only the local database and a Turnstile secret, and emails are printed in the terminal unless `RESEND_API_KEY` and `EMAIL_FROM` are set in `.dev.vars`.

### Preview deployments and other hosts

The Worker's `*.workers.dev` address and preview URLs are switched off (`"workers_dev": false` and `"preview_urls": false` in `wrangler.jsonc`), so it answers only on the domain. If you turn either back on, it runs the same build with the same secrets and the same production database there. Sign-up still refuses every host but `siteUrl`'s, and `robots.txt` disallows crawling, so those addresses can neither collect addresses nor compete with the real site in search results. Unsubscribe links work on any host, because they need a valid token and nothing else.

### Abuse controls

- **Turnstile.** Every sign-up needs a single-use token that the server checks with Siteverify. In production the token must have been issued for the `subscribe` action on `siteUrl`'s host, and Cloudflare's test keys are refused.
- **Address checks.** Throwaway inbox services (a short list in [src/lib/email-checks.ts](./src/lib/email-checks.ts); alias services people keep, such as Apple's Hide My Email, are fine) are refused, and so are domains that can't receive email. The DNS lookup runs only after Turnstile passes, so nobody can use the endpoint to look up domains.
- **One welcome email per address per hour**, however often the address is submitted, so the form can't flood someone's inbox. An address already on the list gets no email at all.
- **At most 30 welcome emails per hour across the site.** The count is kept in D1, a single database, so it holds across every Worker instance. Past the limit, sign-up answers "Too many sign-ups right now" for the rest of the hour. The cost is that someone who keeps solving Turnstile challenges can pause sign-up for an hour; no data is exposed.
- **Bounces and spam reports** take the address off the list for good (with the webhook set up).
- **Resend's own limits.** If Resend refuses an email because of its rate limit or your plan's daily or monthly quota, the sign-up is undone like any failed send. Check your plan's quota against the 30-per-hour cap.
- **Requests.** `POST` only, `application/x-www-form-urlencoded` only, at most 4 KB, and only from `siteUrl`. Astro also rejects form posts from other sites. The webhook takes only requests signed with its secret, at most 64 KB, and no older than five minutes.
- **No IP-based rate limiting in code.** You can add a rate limiting rule for `/api/subscribe/` in the Cloudflare dashboard (Security → WAF) on top of these.

There is no endpoint that reads the list. Subscribers are only ever read with Wrangler or the dashboard, signed in to your Cloudflare account.

**The trade-off of single opt-in:** anyone can type someone else's address, and it gets one welcome email before that person can leave. Turnstile, the hourly limits, and the "if you didn't sign up" link keep that small. A reader who unsubscribed can also be signed up again by someone else, and would then get the next weekly email, which has the unsubscribe link.

## Setting up production

Run the commands from the project folder. Commands that touch your Cloudflare account always say `--remote`, and none of this needs the form to be live.

1. **Connect the domain.** `siteUrl` is already `https://diaryfromtheroad.com`; it is attached to the Worker as described in [The domain](./README.md#the-domain). Sign-up refuses every other host.
2. **Sign in to Wrangler:** `npx wrangler login`.
3. **Create the database** and put its ID in `database_id` in the `d1_databases` block of [wrangler.jsonc](./wrangler.jsonc). Done: the database is `diary-subscribers`. If Wrangler offers to add a binding itself, decline: the block is already written.

   ```bash
   npx wrangler d1 create diary-subscribers
   npx wrangler d1 migrations apply diary-subscribers --remote
   ```

   Or create it in the dashboard: Storage & databases → D1 → Create, named `diary-subscribers`. Apply new migrations with the second command **before** deploying code that needs them.

4. **Turnstile.** In the dashboard, Turnstile → Add widget: add your domain as the hostname (not `localhost`), choose Managed mode, and keep the site key and secret key.
5. **Resend.** In Resend, add your domain (Domains → Add domain) and add the DNS records it lists in Cloudflare's DNS for that domain, then wait until Resend shows the domain as **Verified**. Create an API key with **Sending access**, restricted to that domain. Set the sender in `vars.EMAIL_FROM` in [wrangler.jsonc](./wrangler.jsonc), for example `"Diary From the Road <posts@your-domain>"`, using an address on the verified domain. A DMARC record for the domain (a `TXT` record named `_dmarc`, such as `v=DMARC1; p=none; rua=mailto:hello@your-domain`) helps the emails reach inboxes.
6. **Deploy, still closed:** push to `main`, or

   ```bash
   npm run build
   npx wrangler deploy
   ```

7. **Store the secrets** in the Worker. Each command asks for the value; it is never written to a file. Or use the dashboard: Workers & Pages → `diaryfromtheroad` → Settings → Variables and Secrets → Add, type Secret.

   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   npx wrangler secret put RESEND_API_KEY
   ```

8. **The bounce and spam-report webhook.** In Resend, Webhooks → Add endpoint: URL `https://diaryfromtheroad.com/api/resend-webhook/`, events **email.bounced** and **email.complained**. Copy the endpoint's signing secret (it starts with `whsec_`) and store it:

   ```bash
   npx wrangler secret put RESEND_WEBHOOK_SECRET
   ```

9. **Check before opening:**
   - `npx wrangler secret list` shows `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, and `RESEND_WEBHOOK_SECRET`.
   - `npx wrangler d1 migrations list diary-subscribers --remote` reports no migrations left to apply.
   - Resend shows the domain as Verified, and `EMAIL_FROM` uses it.
   - The Turnstile widget lists the domain in `siteUrl`.
   - The privacy notice at `/privacy/` describes what the subscriber list stores and how to unsubscribe.

10. **Open sign-up:** set `subscriptions.enabled: true` in [src/config/site.ts](./src/config/site.ts), check that the site key in [astro.config.mjs](./astro.config.mjs) is the widget's (it is set for `diaryfromtheroad.com`), then deploy again.
11. **Test it on the live site** with `npx wrangler tail` running: sign up with your own address at the end of a post, on the About page, or in the popup; check that the welcome email and the "New subscriber" note arrive; check the row (below); and unsubscribe from the email's link. To see the popup again after closing it, remove `diary-newsletter` from the site's local storage in your browser's developer tools, or use a private window.

To close sign-up again, set `subscriptions.enabled` back to `false` and deploy.

## Local development

```bash
cp .dev.vars.example .dev.vars
cp .env.example .env.development
npx wrangler d1 migrations apply diary-subscribers --local
npm run dev
```

The examples hold Cloudflare's Turnstile test keys, which always pass. The forms appear at the end of every post and on the home and About pages, the popup opens after 40 seconds on a page (or 15 after scrolling halfway down a long one), and welcome emails are printed in the terminal, with unsubscribe links that work against the local database. The DNS check runs for real, so use an address on a domain that exists. To send real emails locally, put a Resend API key and a sender on your verified domain in `.dev.vars`.

Local development can't write to the production database: `astro dev` and every `--local` command use a copy in `.wrangler/state` (git-ignored), and the binding has no `remote` setting. To inspect the local database:

```bash
npx wrangler d1 execute diary-subscribers --local --command "SELECT email, status, subscribed_at FROM subscribers"
```

### Local values stay out of builds

Cloudflare's Vite plugin copies local variables into the Worker build, as `dist/server/.dev.vars`, so that `npm run preview` can read them. It takes them from `.dev.vars`, or from the `.env` files when there is no `.dev.vars`. Deploys never read that copy, but it put local secrets in the build output. `astro.config.mjs` now deletes it after every build. Checked with canary values in `.dev.vars`, `.env`, and `.env.development`: none of them appeared in `dist/` or in what `npx wrangler deploy --dry-run` would upload. The public files in `dist/client` never included it.

As a result `npm run preview` runs without local secrets, so sign-up is closed there; use `npm run dev` to try it. Keep secrets out of `wrangler.jsonc`, `.env*` files (anything there named `PUBLIC_` ends up in pages), and the repository.

## Exporting subscribers

This exports active subscribers to `subscribers.csv`, with each one's unsubscribe link. The links use `siteUrl`:

```bash
npx wrangler d1 execute diary-subscribers --remote --json --command "SELECT email, subscribed_at, 'https://diaryfromtheroad.com/unsubscribe/?token=' || unsubscribe_token AS unsubscribe_url FROM subscribers WHERE status = 'active' ORDER BY subscribed_at" \
  | jq -r '.[0].results | (["email","subscribed_at","unsubscribe_url"] | @csv), (.[] | [.email, .subscribed_at, .unsubscribe_url] | @csv)' \
  > subscribers.csv
```

`jq` comes with macOS 15 and later; elsewhere, install it or drop the `jq` step and keep the JSON. To look without exporting, open the database in the dashboard (Storage & databases → D1 → `diary-subscribers` → Console) and run the same `SELECT`.

The file holds personal data. `subscribers*.csv` is git-ignored; keep the file private and delete it when you are done.

**When you send the weekly map**, send each person their own email with their `unsubscribe_url` in it, not one email to everyone. Export again before each send so recent unsubscribes, bounces, and spam reports are left out.

**Keep the list healthy.** If someone hasn't clicked a map in about two months, send them one short "still want these?" email, and unsubscribe them if they don't answer. Opens can't tell you this: Apple Mail opens every email by itself. A list of people who want the email keeps spam reports low, which keeps your emails out of spam folders for everyone else.

## Maintenance

Remove someone who asks by reply, replacing the address:

```bash
npx wrangler d1 execute diary-subscribers --remote --command "UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE email = 'reader@example.com' AND status = 'active'"
```

Count subscribers by status:

```bash
npx wrangler d1 execute diary-subscribers --remote --command "SELECT status, COUNT(*) AS count FROM subscribers GROUP BY status"
```

Delete everyone who has unsubscribed, if you don't want to keep their addresses. Keep `bounced` and `complained` rows: they are what stops the form from adding those addresses back.

```bash
npx wrangler d1 execute diary-subscribers --remote --command "DELETE FROM subscribers WHERE status = 'unsubscribed'"
```

If you change what is stored or who handles it, update [the privacy notice](./src/pages/privacy.astro). For a schema change, add a numbered file to `migrations/` and apply it with the same `migrations apply` commands, `--local` first, and to the remote database before the code that needs it is deployed.
