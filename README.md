# Diary From the Road

A personal journal about travel in Southeast Asia, motorcycles, money, remote work, and building software, with a page for the apps built along the way.

Posts and apps are Markdown or MDX files in Astro content collections, settings live in a few TypeScript config files, and every page is prerendered. The only server code is the email sign-up, which runs on Cloudflare Workers with a D1 database and sends its confirmation emails through Resend; there is no CMS.

## What's on the site

- **Home** (`/`): the hero, the lead post, the latest posts, and the apps, each section shown only once it has content
- **Journal** (`/blog/`): every post, with search and topic and tag filters; posts at `/blog/<slug>/`
- **Topics** (`/categories/`) and **Tags** (`/tags/`): a page per topic and tag that has posts
- **Apps** (`/apps/`): every app on one page, one section per app
- **About** (`/about/`), **Contact** (`/contact/`, links to the profiles in the site config; no form), and **Privacy** (`/privacy/`, what the email sign-up stores)
- A search palette on every page (`Ctrl/⌘ + K` or `/`), light and dark modes, and the RSS feed at `/rss.xml`
- Email sign-up at the end of each post, with double opt-in; closed until its production setup is done. See [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md)

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

The site deploys to **Cloudflare Workers** with the `@astrojs/cloudflare` adapter, which does not support Cloudflare Pages. [wrangler.jsonc](./wrangler.jsonc) names the Worker (`diaryfromtheroad`), turns on its `workers.dev` URL, serves the prerendered pages as static assets with the 404 page for unknown paths, and holds the email sender (`EMAIL_FROM`). The subscriber database binding is commented out while subscriptions are off. Secrets are never in the file.

```bash
npm run build
npx wrangler deploy
```

`wrangler deploy` uses the Worker config the build writes, so build first. There is no deploy script in `package.json`. The adapter's session storage is turned off and images are optimized at build time, so the deploy needs no KV namespace or Cloudflare Images binding. Builds delete the copy of local variables (`.dev.vars`) that Cloudflare's Vite plugin writes into `dist/server`, so local secrets never reach the build output; see [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md#local-values-stay-out-of-builds). Email sign-up needs more setup, and stays closed until then; [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md#setting-up-production) has the steps.

### Domains and crawling

`siteUrl` in [src/config/site.ts](./src/config/site.ts) is `https://diaryfromtheroad.com`, the canonical domain. Canonical URLs, Open Graph and Twitter tags, structured data, the RSS feed, the sitemap, and share links all use it, whichever host served the page.

`/robots.txt` is answered by the Worker ([src/lib/robots.ts](./src/lib/robots.ts)). It allows crawling only for requests to exactly `https://diaryfromtheroad.com`, and says `Disallow: /` to every other host: the `workers.dev` URL, preview URLs, `www.`, and plain `http`.

### Temporary deployment on workers.dev

Until the domain is connected, the site runs at `https://diaryfromtheroad.<your-subdomain>.workers.dev`, where the subdomain is your Cloudflare account's; Wrangler prints the full URL when it deploys.

- Every page, including the article, is served there.
- It stays out of search engines: `robots.txt` disallows crawling there, and every page's canonical URL points at `diaryfromtheroad.com`.
- Absolute links point at `diaryfromtheroad.com`, which doesn't answer yet. Share links, link previews (their image is an absolute URL), the RSS feed's item links, and the sitemap work only once the domain is connected. Test the temporary site by browsing it, not by sharing it.
- Email sign-up stays closed: `subscriptions.enabled` is `false`, no database is bound, and requests don't come from `siteUrl`.

To deploy it:

1. `npx wrangler login`
2. In the Cloudflare dashboard (Workers & Pages), make sure your account has a `workers.dev` subdomain; a first-time account is asked to choose one.
3. `npm run release:check`
4. `npm run build`, then `npx wrangler deploy`, and open the URL it prints.

### Connecting diaryfromtheroad.com

No code changes are needed: `siteUrl` already points at the domain.

1. Buy `diaryfromtheroad.com` at GoDaddy.
2. In the Cloudflare dashboard, in the account that has the Worker, add the domain as a site (the Free plan is enough). Cloudflare shows two nameservers.
3. At GoDaddy, turn off DNSSEC for the domain if it is on, then change its nameservers (Domain → DNS → Nameservers → Change → use my own nameservers) to Cloudflare's two. Wait for Cloudflare to mark the site Active; it can take up to a day.
4. Workers & Pages → `diaryfromtheroad` → Settings → Domains & Routes → Add → Custom domain → `diaryfromtheroad.com`. Cloudflare creates the DNS record and the certificate.
5. Check `https://diaryfromtheroad.com`: pages load over HTTPS, `/robots.txt` now allows crawling and lists the sitemap, and a shared link shows its preview.
6. Optional: to make `www.diaryfromtheroad.com` work, add a redirect rule in Cloudflare that sends it to `https://diaryfromtheroad.com`; the canonical domain stays without `www`.
7. Optional: once the domain works, set `"workers_dev": false` in `wrangler.jsonc` and deploy again, so the temporary URL stops answering. Nothing from it was indexed.

## Before launch

- Connect `diaryfromtheroad.com` ([Connecting diaryfromtheroad.com](#connecting-diaryfromtheroadcom)). `siteUrl` already points at it, so until then, share links, link previews, RSS item links, and the sitemap point at a domain that doesn't answer yet.
- Set `email` in `src/config/site.ts` if you want it on the Contact page and in the footer; it is empty and hidden now.
- Replace the tags in `src/config/taxonomy.ts`; they are still the theme's.
- Write the About text where the TODO is in `src/pages/about.astro`.
- Replace `public/favicon.svg`, a plain "D" monogram in the site's colors, with your own mark if you have one, and optionally `public/og-image.png`.
- For email sign-up, follow [Setting up production](./SUBSCRIPTIONS.md#setting-up-production): the D1 database and its binding in `wrangler.jsonc`, Turnstile, a verified sending domain in Resend, `EMAIL_FROM`, and the two secrets. Then check everything and set `subscriptions.enabled` to `true`; until then sign-up stays closed.
- Read the privacy notice in `src/pages/privacy.astro` and adjust it if you run the list differently. It describes what the code does and makes no legal claims; check what applies to you before opening sign-up.

## Credits and license

The code is based on the [Quiet Pages](https://github.com/xocothemes/quietpages) Astro theme by Andrei Alba, under the MIT License in [LICENSE](./LICENSE), which also lists the licenses of the bundled fonts and icons.

- [Newsreader](https://github.com/productiontype/Newsreader) by Production Type, SIL Open Font License
- [Geist and Geist Mono](https://github.com/vercel/geist-font) by Vercel, SIL Open Font License
- [Lucide](https://lucide.dev/), ISC License
- [Bootstrap Icons](https://icons.getbootstrap.com/), MIT License
- The homepage photograph is by Hoang Ngo on Unsplash
