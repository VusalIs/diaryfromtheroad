# Email Subscriptions

Readers can leave their email address to hear about new posts. Addresses are stored in a Cloudflare D1 database that only you can read, with double opt-in: nobody is subscribed until they click the link in a confirmation email, which [Resend](https://resend.com/) delivers. There are no campaigns and no automatic post emails; you export the list and write to subscribers yourself.

**Status: sign-up is closed.** `subscriptions.enabled` in [src/config/site.ts](./src/config/site.ts) is `false`. The domain, Resend, Turnstile, the secrets, and the D1 database (`diary-subscribers`, with its table) are set up; what's left is the build's site key, the privacy section, and a live test. Until sign-up is enabled, production builds leave the form out and the endpoint answers "Email sign-up isn't open yet" without storing anything.

## How it works

| Piece                  | Where                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------ |
| The form               | [src/components/blog/SubscribeForm.astro](./src/components/blog/SubscribeForm.astro) |
| `POST /api/subscribe/` | [src/pages/api/subscribe.ts](./src/pages/api/subscribe.ts)                           |
| `/subscribe/confirm/`  | [src/pages/subscribe/confirm.astro](./src/pages/subscribe/confirm.astro)             |
| `/unsubscribe/`        | [src/pages/unsubscribe.astro](./src/pages/unsubscribe.astro)                         |
| `/privacy/`            | [src/pages/privacy.astro](./src/pages/privacy.astro)                                 |
| Logic, Resend, checks  | [src/lib/subscriptions.ts](./src/lib/subscriptions.ts)                               |
| Bindings and secrets   | [src/lib/subscriptions-env.ts](./src/lib/subscriptions-env.ts)                       |
| Database schema        | [migrations/0001_create_subscribers.sql](./migrations/0001_create_subscribers.sql)   |
| Tests                  | [tests/subscriptions.test.ts](./tests/subscriptions.test.ts), run by `npm test`      |

1. **The form** sits at the end of every article, after the share row and before Previous and Next: a reader who has just finished a post is the one most likely to want the next. It is hidden without JavaScript, which the spam check needs, and Cloudflare's Turnstile script loads only when someone focuses the field. It links to the privacy notice at `/privacy/`, which the footer links too. That page currently describes the site without sign-up, so it needs a section on the subscriber list before sign-up opens (the subscriber-list wording it had before is in commit `6a906c9`).
2. **Sign-up** posts the address and a Turnstile token to `/api/subscribe/`. The server checks the token with Turnstile's Siteverify, validates and normalizes the address (trimmed, lowercased, at most 254 characters), stores it as `pending`, and sends the confirmation email through Resend's HTTP API. The reply is the same whether the address is new, pending, or already subscribed, so it never reveals who is on the list. If Resend refuses the email or can't be reached, the sign-up is rolled back.
3. **Confirming** opens `/subscribe/confirm/?token=…` on `siteUrl`, which shows a button; the subscription becomes `active` when it is pressed. The extra click keeps mail scanners that follow links from confirming on someone's behalf. A link works once, for 48 hours.
4. **Unsubscribing** opens `/unsubscribe/?token=…`, which also shows a button. The confirmation email carries the same link in `List-Unsubscribe` headers, so mail apps can offer their own unsubscribe button, which posts to the link. A confirmed subscriber is kept as `unsubscribed`, so exports leave them out; an address that was never confirmed is deleted.

### What is stored

One row per address in the `subscribers` table: the address, its status (`pending`, `active`, or `unsubscribed`), when it signed up, when the confirmation email went out, when it was confirmed, when it unsubscribed, a SHA-256 hash of the current confirmation token, and a random unsubscribe token. Nothing else: no name, no IP address, no browser details. The visitor's IP address goes to Turnstile's Siteverify with the token and is not kept. Resend receives the address and the email it delivers.

Unconfirmed addresses are deleted by the next sign-up after their 48-hour link expires.

## When sign-up opens

In production, sign-up opens only when all of these hold. If any is missing, the endpoint answers 503 without storing anything and logs which ones, by name and never by value (`npx wrangler tail` shows the log):

- `subscriptions.enabled` is `true` in [src/config/site.ts](./src/config/site.ts).
- `siteUrl` (`https://diaryfromtheroad.com`) is not the `example.com` placeholder, and the request came from it, so the domain has to be connected first. Sign-ups from any other address, such as the Worker's `*.workers.dev` URL, are refused, so the links in emails always point at `siteUrl`, and the Turnstile challenge must have been solved on that host.
- The Worker has the `SUBSCRIBERS_DB` binding.
- The `TURNSTILE_SECRET_KEY` secret is set and isn't one of Cloudflare's test keys.
- The `RESEND_API_KEY` secret is set and looks like a Resend key (`re_…`).
- The `EMAIL_FROM` variable is one valid sender, such as `Diary From the Road <posts@your-domain>`.

The form appears in a production build only when `subscriptions.enabled` is `true` and the build has a Turnstile site key. The site's real key is the default for `PUBLIC_TURNSTILE_SITE_KEY` in [astro.config.mjs](./astro.config.mjs); it is public, so it lives in the code, and an environment variable of the same name overrides it. A build with sign-up enabled fails if that key is a Cloudflare test key or `siteUrl` is still the placeholder.

**What the code can't check is that the sender's domain is verified in Resend.** A sending-only Resend API key, the right kind for this, can't read domain status. That is why `subscriptions.enabled` is a switch you turn on yourself after checking. If the domain isn't verified, Resend refuses every email with `403 validation_error`, each sign-up is rolled back with "The confirmation email couldn't be sent", and the log says so.

In development (`npm run dev`), `subscriptions.enabled` is ignored: sign-up needs only the local database and a Turnstile secret, and emails are printed in the terminal unless `RESEND_API_KEY` and `EMAIL_FROM` are set in `.dev.vars`.

### Preview deployments and other hosts

Preview URLs and the Worker's `*.workers.dev` address run the same build with the same secrets and the same production database. Sign-up refuses every host but `siteUrl`'s, and their `robots.txt` disallows crawling, so they can neither collect addresses nor compete with the real site in search results. Confirm and unsubscribe links work on any host, because they need a valid token and nothing else. Once the custom domain works, you can switch the other addresses off with `"workers_dev": false` and `"preview_urls": false` in `wrangler.jsonc`.

### Abuse controls

- **Turnstile.** Every sign-up needs a single-use token that the server checks with Siteverify. In production the token must have been issued for the `subscribe` action on `siteUrl`'s host, and Cloudflare's test keys are refused.
- **One confirmation email per address per hour**, however often the address is submitted, so the form can't flood someone's inbox.
- **At most 30 confirmation emails per hour across the site.** The count is kept in D1, a single database, so it holds across every Worker instance. Past the limit, sign-up answers "Too many sign-ups right now" for the rest of the hour. The cost is that someone who keeps solving Turnstile challenges can pause sign-up for an hour; no data is exposed.
- **Resend's own limits.** If Resend refuses an email because of its rate limit or your plan's daily or monthly quota, the sign-up is rolled back like any failed send. Check your plan's quota against the 30-per-hour cap.
- **Requests.** `POST` only, `application/x-www-form-urlencoded` only, at most 4 KB, and only from `siteUrl`. Astro also rejects form posts from other sites.
- **No IP-based rate limiting in code.** Once the site is on its own domain, you can add a rate limiting rule for `/api/subscribe/` in the Cloudflare dashboard (Security → WAF) on top of these.

There is no endpoint that reads the list. Subscribers are only ever read with Wrangler or the dashboard, signed in to your Cloudflare account.

## Setting up production

Run the commands from the project folder. Commands that touch your Cloudflare account always say `--remote`, and none of this needs the form to be live.

1. **Connect the domain.** `siteUrl` is already `https://diaryfromtheroad.com`; follow [Connecting diaryfromtheroad.com](./README.md#connecting-diaryfromtheroadcom) so the Worker answers on it. Sign-up refuses every other host.
2. **Sign in to Wrangler:** `npx wrangler login`.
3. **Create the database** and put its ID in `database_id` in the `d1_databases` block of [wrangler.jsonc](./wrangler.jsonc). Done: the database is `diary-subscribers`. If Wrangler offers to add a binding itself, decline: the block is already written.

   ```bash
   npx wrangler d1 create diary-subscribers
   npx wrangler d1 migrations apply diary-subscribers --remote
   ```

   Or create it in the dashboard: Storage & databases → D1 → Create, named `diary-subscribers`.

4. **Turnstile.** In the dashboard, Turnstile → Add widget: add your domain as the hostname (not `localhost`), choose Managed mode, and keep the site key and secret key.
5. **Resend.** In Resend, add your domain (Domains → Add domain) and add the DNS records it lists in Cloudflare's DNS for that domain, then wait until Resend shows the domain as **Verified**. Create an API key with **Sending access**, restricted to that domain. Set the sender in `vars.EMAIL_FROM` in [wrangler.jsonc](./wrangler.jsonc), for example `"Diary From the Road <posts@your-domain>"`, using an address on the verified domain.
6. **Deploy, still closed:**

   ```bash
   npm run build
   npx wrangler deploy
   ```

7. **Store the secrets** in the Worker. Each command asks for the value; it is never written to a file. Or use the dashboard: Workers & Pages → `diaryfromtheroad` → Settings → Variables and Secrets → Add, type Secret.

   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   npx wrangler secret put RESEND_API_KEY
   ```

8. **Check before opening:**
   - `npx wrangler secret list` shows `TURNSTILE_SECRET_KEY` and `RESEND_API_KEY`.
   - `npx wrangler d1 migrations list diary-subscribers --remote` reports no migrations left to apply.
   - Resend shows the domain as Verified, and `EMAIL_FROM` uses it.
   - The Turnstile widget lists the domain in `siteUrl`.
   - The privacy notice at `/privacy/` has a section on what the subscriber list stores and how to unsubscribe.

9. **Open sign-up:** set `subscriptions.enabled: true` in [src/config/site.ts](./src/config/site.ts), check that the site key in [astro.config.mjs](./astro.config.mjs) is the widget's (it is set for `diaryfromtheroad.com`), then build and deploy again.
10. **Test it on the live site** with `npx wrangler tail` running: sign up with your own address at the end of a post, confirm from the email, check the row (below), and unsubscribe from the email's link.

To close sign-up again, set `subscriptions.enabled` back to `false` and deploy.

## Local development

```bash
cp .dev.vars.example .dev.vars
cp .env.example .env.development
npx wrangler d1 migrations apply diary-subscribers --local
npm run dev
```

The examples hold Cloudflare's Turnstile test keys, which always pass. The form appears at the end of every post, and confirmation emails are printed in the terminal, with links that work against the local database. To send real emails locally, put a Resend API key and a sender on your verified domain in `.dev.vars`.

Local development can't write to the production database: `astro dev` and every `--local` command use a copy in `.wrangler/state` (git-ignored), and the binding has no `remote` setting. To inspect the local database:

```bash
npx wrangler d1 execute diary-subscribers --local --command "SELECT email, status, created_at, confirmed_at FROM subscribers"
```

### Local values stay out of builds

Cloudflare's Vite plugin copies local variables into the Worker build, as `dist/server/.dev.vars`, so that `npm run preview` can read them. It takes them from `.dev.vars`, or from the `.env` files when there is no `.dev.vars`. Deploys never read that copy, but it put local secrets in the build output. `astro.config.mjs` now deletes it after every build. Checked with canary values in `.dev.vars`, `.env`, and `.env.development`: none of them appeared in `dist/` or in what `npx wrangler deploy --dry-run` would upload. The public files in `dist/client` never included it.

As a result `npm run preview` runs without local secrets, so sign-up is closed there; use `npm run dev` to try it. Keep secrets out of `wrangler.jsonc`, `.env*` files (anything there named `PUBLIC_` ends up in pages), and the repository.

## Exporting subscribers

This exports confirmed, active subscribers to `subscribers.csv`, with each one's unsubscribe link. The links use `siteUrl`:

```bash
npx wrangler d1 execute diary-subscribers --remote --json --command "SELECT email, confirmed_at, 'https://diaryfromtheroad.com/unsubscribe/?token=' || unsubscribe_token AS unsubscribe_url FROM subscribers WHERE status = 'active' AND confirmed_at IS NOT NULL ORDER BY confirmed_at" \
  | jq -r '.[0].results | (["email","confirmed_at","unsubscribe_url"] | @csv), (.[] | [.email, .confirmed_at, .unsubscribe_url] | @csv)' \
  > subscribers.csv
```

`jq` comes with macOS 15 and later; elsewhere, install it or drop the `jq` step and keep the JSON. To look without exporting, open the database in the dashboard (Storage & databases → D1 → `diary-subscribers` → Console) and run the same `SELECT`.

The file holds personal data. `subscribers*.csv` is git-ignored; keep the file private and delete it when you are done.

**When you write to subscribers**, send each person their own email with their `unsubscribe_url` in it, not one email to everyone. Export again before each send so recent unsubscribes are left out.

## Maintenance

Remove someone who asks by reply, replacing the address:

```bash
npx wrangler d1 execute diary-subscribers --remote --command "UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), confirmation_token_hash = NULL WHERE email = 'reader@example.com'"
```

Delete unconfirmed addresses whose link has expired (each sign-up does this too):

```bash
npx wrangler d1 execute diary-subscribers --remote --command "DELETE FROM subscribers WHERE status = 'pending' AND (confirmation_sent_at IS NULL OR confirmation_sent_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-48 hours'))"
```

Count subscribers by status:

```bash
npx wrangler d1 execute diary-subscribers --remote --command "SELECT status, COUNT(*) AS count FROM subscribers GROUP BY status"
```

Delete everyone who has unsubscribed, if you don't want to keep their addresses:

```bash
npx wrangler d1 execute diary-subscribers --remote --command "DELETE FROM subscribers WHERE status = 'unsubscribed'"
```

If you change what is stored or who handles it, update [the privacy notice](./src/pages/privacy.astro). For a schema change, add a numbered file to `migrations/` and apply it with the same `migrations apply` commands, `--local` first.
