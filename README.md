# Diary From the Road

A personal journal about travel in Southeast Asia, motorcycles, money, remote work, and building software, with a page for the apps built along the way.

Posts and apps are Markdown or MDX files in Astro content collections, settings live in a few TypeScript config files, and every page is prerendered. The only server code is the email sign-up, which runs on Cloudflare Workers with a D1 database and sends its confirmation emails through Resend; there is no CMS.

## What's on the site

- **Home** (`/`): the hero, the lead post, the latest posts, and the apps, each section shown only once it has content
- **Journal** (`/blog/`): every post, with search and topic and tag filters; posts at `/blog/<slug>/`
- **Topics** (`/categories/`) and **Tags** (`/tags/`): a page per topic and tag that has posts
- **Apps** (`/apps/`): every app on one page, one section per app
- **About** (`/about/`), **Contact** (`/contact/`, links to the profiles in the site config; no form), and **Privacy** (`/privacy/`, what the site does with visitors' information)
- A search palette on every page (`Ctrl/⌘ + K` or `/`), light and dark modes, and the RSS feed at `/rss.xml`
- Email sign-up for the weekly map (a Google Maps list of places, once a week), at the end of each post and in a popup that opens once per visit at most, with double opt-in (Cloudflare D1, Turnstile, and Resend). See [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md)

## Stack

- [Astro](https://astro.build/) 7 with `@astrojs/mdx`; pages are prerendered
- `@astrojs/cloudflare` and Wrangler: the site deploys as a Cloudflare Worker, which serves the pages and runs the email sign-up routes
- Cloudflare D1 for subscribers, Cloudflare Turnstile against spam sign-ups, and Resend's HTTP API for confirmation emails (no SDK)
- Tailwind CSS 4 through `@tailwindcss/vite`
- TypeScript, with content collections validated by Zod schemas
- `@astrojs/rss`, `@astrojs/sitemap`, and Sharp for image optimization
- Self-hosted Newsreader, Geist, and Geist Mono fonts; local Lucide and Bootstrap Icons SVGs
- `@astrojs/check`, Prettier (with `prettier-plugin-astro`), and Node's built-in test runner for validation

## Requirements

- Node.js 22.12.0 or newer (`engines` in `package.json`)
- npm (the repository uses `package-lock.json`)

## Local development

```bash
npm install
npm run dev
```

| Command                 | What it does                                                                      |
| ----------------------- | --------------------------------------------------------------------------------- |
| `npm run dev`           | Starts the Astro dev server, running the Worker routes locally                    |
| `npm run build`         | Builds the site into `dist/`: pages in `dist/client`, the Worker in `dist/server` |
| `npm run preview`       | Serves the build locally in Cloudflare's runtime, without local secrets           |
| `npm run check`         | Runs `astro check`: types, content schemas, and `.astro` files                    |
| `npm test`              | Runs the email subscription tests in `tests/`                                     |
| `npm run format`        | Formats the repository with Prettier                                              |
| `npm run format:check`  | Checks formatting without writing                                                 |
| `npm run release:check` | Runs `check`, `test`, `build`, then `format:check`                                |

The email sign-up needs a little local setup to try out; see [Local development in SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md#local-development).

## Project layout

| Path                     | Contents                                                                   |
| ------------------------ | -------------------------------------------------------------------------- |
| `src/config/site.ts`     | Site name, description, production URL, author, email, socials, navigation |
| `src/config/taxonomy.ts` | Topics (`categories`) and tags                                             |
| `src/config/home.ts`     | Homepage copy                                                              |
| `src/content/blog/`      | Journal posts                                                              |
| `src/content/apps/`      | Apps                                                                       |
| `src/content.config.ts`  | The schemas for both collections                                           |
| `src/pages/`             | Routes                                                                     |
| `src/styles/global.css`  | Design tokens, light and dark                                              |
| `src/lib/subscriptions*` | Email sign-up, confirmation, and unsubscribe                               |
| `migrations/`            | The D1 database schema                                                     |
| `tests/`                 | Tests for the email subscription logic                                     |

[CUSTOMIZATION.md](./CUSTOMIZATION.md) covers every setting, component, and route in detail.

## Writing a post

Each post is a folder in `src/content/blog/`, named for its URL, holding an `index.mdx` (or `index.md`) and its photos:

```text
src/content/blog/your-post-slug/
|-- index.mdx
`-- cover.jpg
```

That folder is published at `/blog/your-post-slug/`. The frontmatter:

```yaml
---
title: ""
excerpt: "" # one or two sentences: the standfirst, the card text, and the meta description
date: 2026-01-31
category: "travel" # travel, motorcycles, money, remote-work, or building-things
tags: [] # slugs from src/config/taxonomy.ts
thumbnail: ./cover.jpg # required, a photo in the post's folder
thumbnailAlt: "" # what the cover shows
featured: false # true makes it the homepage's lead post
draft: true # true keeps it off the whole site, including in `npm run dev`
---
```

- `category` and `tags` must exist in `src/config/taxonomy.ts`; an unknown value fails `npm run check` and the build. Add a tag there before using it.
- Optional fields: `updated`, `readingTime`, `seoTitle`, `seoDescription`, `canonical`, and `imageCredit` for someone else's photo.
- Start body headings at `##`; the title is the page's `h1`.
- Put images in the post's folder and write `![Alt text](./photo.jpg)`, or use `<Figure>` in MDX for a caption.
- Remove GPS data from photos before committing them.

[src/content/blog/README.md](./src/content/blog/README.md) has the full template and photo guidance.

## Adding an app

Each app is a folder in `src/content/apps/`, holding an `index.md` with its logo and screenshots beside it:

```text
src/content/apps/your-app/
|-- index.md
|-- logo.png
|-- screenshot-1.png
`-- screenshot-2.png
```

The folder name becomes the app's anchor, `/apps/#your-app`, and the homepage lists every app with a link there. The frontmatter:

```yaml
---
name: ""
summary: "" # one or two sentences
logo: ./logo.png # optional, square, at least 256px wide
appStore: "" # optional, the App Store URL
links: [] # optional, e.g. [{ label: "Website", url: "https://…" }]
status: "" # optional, shown as a small label
platforms: [] # optional, e.g. ["iOS"]
screenshots: # optional, up to four
  - src: ./screenshot-1.png
    alt: ""
order: 0 # lower comes first; ties sort by name
draft: true # true keeps it off the site
---
```

Text below the frontmatter appears under the summary. A missing `name` or `summary`, or a link that is not a full URL, fails the build. See [src/content/apps/README.md](./src/content/apps/README.md).

## Checks

Run the full check before committing or deploying:

```bash
npm run release:check
```

It runs `astro check`, the tests, the production build, and Prettier's check, and stops at the first failure. Fix formatting with `npm run format`.

## Deployment

The site deploys to **Cloudflare Workers** with the `@astrojs/cloudflare` adapter, which does not support Cloudflare Pages. [wrangler.jsonc](./wrangler.jsonc) names the Worker (`diaryfromtheroad`), keeps its `workers.dev` URL and preview URLs off so it answers only on the domain, serves the prerendered pages as static assets with the 404 page for unknown paths, and holds the email sender (`EMAIL_FROM`) and the address told about new subscribers (`NOTIFY_EMAIL`). It also binds the subscriber database (`SUBSCRIBERS_DB`, the D1 database `diary-subscribers`). Secrets are never in the file.

Every push to `main` on GitHub builds and deploys the site through Cloudflare Workers Builds, in about a minute. To deploy by hand:

```bash
npm run build
npx wrangler deploy
```

`wrangler deploy` uses the Worker config the build writes, so build first. There is no deploy script in `package.json`. The adapter's session storage is turned off and images are optimized at build time, so the deploy needs no KV namespace or Cloudflare Images binding. Builds delete the copy of local variables (`.dev.vars`) that Cloudflare's Vite plugin writes into `dist/server`, so local secrets never reach the build output; see [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md#local-values-stay-out-of-builds). Email sign-up has its own setup, described in [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md#setting-up-production).

### Domains and crawling

`siteUrl` in [src/config/site.ts](./src/config/site.ts) is `https://diaryfromtheroad.com`, the canonical domain. Canonical URLs, Open Graph and Twitter tags, structured data, the RSS feed, the sitemap, and share links all use it, whichever host served the page.

`/robots.txt` is answered by the Worker ([src/lib/robots.ts](./src/lib/robots.ts)). It allows crawling only for requests to exactly `https://diaryfromtheroad.com`, and says `Disallow: /` to any other host the Worker might answer on, such as a `workers.dev` or preview URL if they are turned back on.

### The domain

`diaryfromtheroad.com` is registered with Cloudflare Registrar, so its DNS is on Cloudflare. In the Cloudflare dashboard:

- **Workers & Pages → `diaryfromtheroad` → Settings → Domains & Routes** has `diaryfromtheroad.com` as a custom domain, which gives it its DNS record and certificate. It isn't in `wrangler.jsonc`, and deploys leave it as it is.
- **SSL/TLS → Edge Certificates → Always Use HTTPS** is on, so plain `http` redirects to `https`.
- **Rules → Redirect Rules** sends `www.diaryfromtheroad.com` to `https://diaryfromtheroad.com` with a 301. A proxied `AAAA` record for `www` pointing at `100::` lets the rule see those requests.
- **DNS → Settings → DNSSEC** is on.
- **Email → Email Routing** forwards `hello@diaryfromtheroad.com` to a personal inbox (its `MX` and SPF records are on the root), and the DNS records Resend asked for let the site send email from the domain ([SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md)).
- Google Search Console has the domain, with `sitemap-index.xml` submitted.

## Before launch

- Set `email` in `src/config/site.ts` if you want it on the Contact page and in the footer; it is empty and hidden now.
- The tags in `src/config/taxonomy.ts` are places and recurring themes (Vietnam, Cost of Living, Living Abroad, and so on). Add one there before using it in a post.
- Replace `public/favicon.svg`, a plain "D" monogram in the site's colors, with your own mark if you have one (and `public/favicon.ico`, the same mark at 16, 32, and 48 pixels), and optionally `public/og-image.png`.
- Email sign-up is set up and on. To close it, set `subscriptions.enabled` to `false` in `src/config/site.ts`; to keep only the end-of-post form, set `subscriptions.popup` to `false`. [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md) has the details.
- The privacy notice in `src/pages/privacy.astro` describes what the site and the subscriber list store, and who handles them. It makes no legal claims; check what applies to you, and update it if you change how the list works.

## Credits and license

The code is based on the [Quiet Pages](https://github.com/xocothemes/quietpages) Astro theme by Andrei Alba, under the MIT License in [LICENSE](./LICENSE), which also lists the licenses of the bundled fonts and icons.

- [Newsreader](https://github.com/productiontype/Newsreader) by Production Type, SIL Open Font License
- [Geist and Geist Mono](https://github.com/vercel/geist-font) by Vercel, SIL Open Font License
- [Lucide](https://lucide.dev/), ISC License
- [Bootstrap Icons](https://icons.getbootstrap.com/), MIT License
- The homepage photograph is by Hoang Ngo on Unsplash
