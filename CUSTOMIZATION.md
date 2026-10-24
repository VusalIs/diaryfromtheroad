# Customization Guide

How Diary From the Road is put together, and where to change each part of it.

## Site Settings

Edit [src/config/site.ts](./src/config/site.ts) first. It holds the site's name, the default metadata, the canonical domain, the language and date locale, the social image, the author, the contact email, and the social links.

Set `siteConfig.siteUrl` before building for production. Canonical URLs, social image URLs, the RSS feed, `robots.txt`, the sitemap, and JSON-LD all derive from it.

| Key              | What it controls                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `name`           | The wordmark in the header and footer, the `<title>` suffix on every page, the feed title  |
| `title`          | The homepage `<title>` and its social title                                                |
| `description`    | The default meta description, the feed description, and the line under the footer wordmark |
| `siteUrl`        | The canonical domain, `https://diaryfromtheroad.com`, without a trailing slash             |
| `language`       | The `lang` attribute, the feed language, and the language in structured data               |
| `locale`         | The Open Graph locale, for example `en_US`                                                 |
| `dateLocale`     | How dates are written, for example `en-US` or `en-GB`                                      |
| `socialImage`    | The Open Graph and Twitter/X image for pages without their own, a path in `public/`        |
| `wordsPerMinute` | The reading speed used to estimate read time when a post has no `readingTime`              |
| `author`         | The journal's single author; see [Author](#author)                                         |
| `email`          | The Contact page address and the footer's mail icon; leave it empty to hide both           |
| `socials`        | The icon links in the footer and the chips on the Contact page; empty by default           |
| `subscriptions`  | `enabled` opens email sign-up in production; see [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md)    |

Each social link takes a `label`, an `href`, and an `icon`, which is a file name from [src/icons/bootstrap](./src/icons/bootstrap) such as `twitter-x`, `bluesky`, `github`, `mastodon`, `instagram`, or `threads`.

`navigation` in the same file is the header and mobile menu. A link is marked as the current page when the path starts with its `href`, so Journal stays highlighted while reading a post. The header holds only Journal, Apps, and About, plus search and the theme toggle; the wordmark links home. Topics have no header link: readers reach them from the Journal's "Browse by topic" link and Topic menu, each card's topic label, and the article breadcrumbs. `footerLinks` is the footer's single row of links, beside the wordmark, and holds only what the header doesn't: the RSS feed and the privacy notice. Tags, the Tags page, and the Contact page are not linked from the header or footer; tags are reached from articles and the Journal's filter.

The header and footer show `name` as a serif wordmark. The favicon is [public/favicon.svg](./public/favicon.svg), a plain "D" monogram in the ink and canvas colors, written into the file; replace it with your own mark. The footer's copyright line and type credit are in [src/components/chrome/SiteFooter.astro](./src/components/chrome/SiteFooter.astro).

The About and Contact pages are written directly in [src/pages/about.astro](./src/pages/about.astro) and [src/pages/contact.astro](./src/pages/contact.astro). The About page shows the site description under its heading; a comment in the file marks where your own text goes. The Contact page has no form: it links the Instagram profile in `socials` by its handle, lists the other profiles and the RSS feed under "Elsewhere", and shows `email` when it is set.

## Author

The journal has one author, `siteConfig.author` in `site.ts`:

```ts
author: {
  name: "Your Name",
},
```

The name is the `dc:creator` of every item in the RSS feed, and the `author` and `publisher` of every article's `BlogPosting` structured data, linked to the About page. Posts carry no `author` field, and there are no bylines, portraits, or author pages.

## Topics and Tags

Topics and tags live in [src/config/taxonomy.ts](./src/config/taxonomy.ts), and the config is authoritative: it, not the content, decides what exists. In the code topics are called `categories`, and their pages live at `/categories/<slug>/`.

```ts
export const categories = [
  {
    slug: "travel",
    name: "Travel",
    description: "Travel and everyday life in Southeast Asia.",
  },
  // ...
] as const satisfies readonly Category[];

export const tags = [
  { slug: "writing", name: "Writing" },
  // ...
] as const satisfies readonly Term[];
```

- A post's `category` and `tags` are validated against these slugs with `z.enum`, so a typo fails the build. Add a topic or tag to the config before using it in a post.
- Topic and tag pages are only generated for terms with at least one published post, and the Journal's menus and the Topics page skip empty terms too, so no link leads to an empty page.
- Order in `categories` is the order everywhere topics are listed. Tags keep their order in the archive menu; the Tags page sorts them by post count.
- A topic's `description` is the lead on its page, its line on the Topics page, and part of its meta description.

To rename a slug, change it in the config and in every post that uses it; `npm run check` lists any post you missed.

## Writing Posts

Each post is a folder in [src/content/blog](./src/content/blog) holding an `index.mdx` (or `index.md`) and the images it uses. The [README](./src/content/blog/README.md) in that folder has a frontmatter template and photo guidance.

```text
src/content/blog/your-post-slug/
|-- index.mdx
`-- cover.jpg
```

The folder name is the URL: `src/content/blog/your-post-slug/` becomes `/blog/your-post-slug/`. Frontmatter is validated by [src/content.config.ts](./src/content.config.ts):

```yaml
---
title: "Post title"
excerpt: "One or two sentences that introduce the post."
date: 2026-01-31
updated: 2026-02-02
category: "travel"
tags: []
thumbnail: ./cover.jpg
thumbnailAlt: "What the cover photo shows."
imageCredit:
  caption: "A caption."
  author: "Photographer Name"
  authorUrl: "https://example.com/photographer"
  source: "Source"
  sourceUrl: "https://example.com/photo"
featured: false
draft: false
---
```

| Field            | Notes                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `title`          | Required. The headline, the `<title>`, and the card and search title                                 |
| `excerpt`        | Required. The standfirst, the card text, the meta description, the feed item, and searched           |
| `date`           | Required. The publication date; posts are listed newest first                                        |
| `updated`        | Shown as "Updated" in the byline and used as `dateModified` in the JSON-LD                           |
| `category`       | Required. A topic slug from `src/config/taxonomy.ts`                                                 |
| `tags`           | Tag slugs from `src/config/taxonomy.ts`. Defaults to none                                            |
| `thumbnail`      | Required. A local image beside the post: the card image, the lead image, and the social card         |
| `thumbnailAlt`   | Required. Alt text for the lead image on the article page                                            |
| `imageCredit`    | A caption and credit under the lead image, for someone else's photo. `source` defaults to `Unsplash` |
| `readingTime`    | Minutes. Left out, it is estimated from the body, ignoring code blocks and HTML tags                 |
| `featured`       | Makes the post a candidate for the homepage lead post                                                |
| `draft`          | `true` keeps the post out of every page, listing, the feed, the search index, and the sitemap        |
| `seoTitle`       | Overrides the `<title>` without changing the headline                                                |
| `seoDescription` | Overrides the meta description without changing the standfirst                                       |
| `canonical`      | An absolute URL, for a piece first published elsewhere                                               |

Start the body's headings at `##`; the title is the page's only `h1`.

## Homepage

The homepage is assembled in [src/pages/index.astro](./src/pages/index.astro) from sections in [src/components/home](./src/components/home), with copy in [src/config/home.ts](./src/config/home.ts):

| Section    | Component           | Config key                   |
| ---------- | ------------------- | ---------------------------- |
| Hero       | `Hero.astro`        | `homeConfig.hero`            |
| Lead post  | `LeadStory.astro`   | the `featured` flag in posts |
| More posts | `LatestPosts.astro` | `homeConfig.latest`          |
| Apps       | `AppList.astro`     | `homeConfig.apps`            |

**The hero** pairs the text with a photograph: the site name as the page's `h1`, `hero.lead` under it, and `hero.link`, a link to the journal, beside [src/assets/hero-road.jpg](./src/assets/hero-road.jpg) from `64rem` and above it on narrower screens. The photo is shown whole at 3:2 on phones, cropped to 16:9 on tablets and 4:3 beside the text, with no overlay or filter. It is the page's largest image, so it loads eagerly with high priority. To change it, replace the import, the `alt` text, and the `object-[x_y]` focal point in [src/components/home/Hero.astro](./src/components/home/Hero.astro); use a landscape photo about 2400 pixels wide.

**The lead post** is the newest post with `featured: true`, or the newest post if none is flagged. Flag more than one and the newest flagged post wins; the others appear in the grid.

**More posts** shows the newest posts after the lead, up to `latest.count`, with a link to the Journal, which lists every post and has the filters. With one or two, the cards share the row in halves and request larger images; with three or more they sit in thirds. Each card's topic label links to its topic page; the full topic directory is the Topics page.

**Apps** lists every app in a text row, with its logo, name, summary, and status, each linking to its section of the Apps page; see [Apps](#apps).

Each section appears only when it has something to show: with no posts and no apps the homepage is just the hero, and with one post it is the hero and the lead post.

## Apps

The Apps page, [src/pages/apps/index.astro](./src/pages/apps/index.astro), shows every app on one page, each in its own section anchored by its folder name (`/apps/#your-app`). The apps are a content collection in [src/content/apps](./src/content/apps), one folder per app holding an `index.md` with its logo and screenshots beside it; the [README](./src/content/apps/README.md) there has the frontmatter template. The schema is the `apps` collection in [src/content.config.ts](./src/content.config.ts).

Each section, [src/components/apps/AppEntry.astro](./src/components/apps/AppEntry.astro), shows the logo, the name, the `status` and `platforms` as small labels, the `summary`, any text written below the frontmatter, the App Store link as the main button and any other `links` beside it, and up to four screenshots. Screenshots are shown whole, never cropped, and open in the same lightbox as pictures in a post. There is no App Store badge: Apple's badge must be its own artwork, so the link is a plain button.

Apps are listed by `order`, then name, and `draft: true` hides one everywhere. With no apps, the page says so and the homepage leaves its Apps section out.

The header sits transparent at the top of every page and turns solid once the page scrolls. It hides while the reader scrolls down and returns when they scroll up or tab into it.

## Search

The search palette is [src/components/chrome/SearchDialog.astro](./src/components/chrome/SearchDialog.astro), included on every page by `BaseLayout.astro`. It opens with the search button in the header, `Ctrl/⌘ + K`, or `/` when the cursor is not in a text field. Any element with a `data-search-open` attribute opens it too, like the "Search the journal" button on the 404 page. Without JavaScript the header button is a plain link to the Journal.

- The index is `/search-index.json`, built from [src/pages/search-index.json.ts](./src/pages/search-index.json.ts). It holds each published post's title, excerpt, topic, tags, and date, not the full text, so it stays small. It is fetched the first time the palette opens, or as soon as a reader hovers or focuses a search button.
- Before the first keystroke the palette lists the five most recent posts.
- Every word in the query must match somewhere. A word in the title scores 8, in the topic or tags 4, and in the excerpt 1; the whole query in the title adds 4. Ties go to the newer post, and the top eight are shown. Matching ignores case and accents.
- The last row, "Search the journal for …", opens the Journal with the query filled in.
- Arrow keys move through the results, `Enter` opens one, and `Escape` or a click on the backdrop closes the palette and returns focus to whatever opened it.

`MAX_RESULTS` and `RECENT_COUNT` at the top of the palette's script set the number of results and recent posts. To index another field, add it to `SearchEntry` in `search-index.json.ts` and to the `search` function in the palette.

## The Archive

[src/pages/blog/index.astro](./src/pages/blog/index.astro) renders every published post as a grid of cards, newest first, then filters it in the browser. A "Browse by topic" link under the title leads to the Topics page. Three controls combine in the toolbar above the grid: a search field, a **Topic** menu, and a **Tag** menu.

- The search field filters as you type, matching titles, excerpts, topics, and tags. Every word must appear. The text it matches is the card's `data-search` attribute, built in [src/components/blog/PostCard.astro](./src/components/blog/PostCard.astro).
- Each menu is a native `<details>` element. One opens at a time, and it closes on a selection, a click outside, or `Escape`, which returns focus to the pill.
- Each option shows how many posts it would return given the other active filters and the query. Options that would return nothing are dimmed, and options with no published post behind them are left out at build time.
- Every option is a real link to its topic or tag page, so without JavaScript the menus still work as navigation and the whole list is shown.
- Selecting the active option again clears it, and **Clear filters** appears while a topic or tag is selected.
- The state lives in the URL as `?q=&cat=&tag=&page=`, so a filtered view can be shared and the Back button walks through it. An unknown topic or tag in the URL is ignored. The search palette's archive row and the site's `SearchAction` structured data both link here with `?q=`.

`pageSize` at the top of the page script sets how many posts show at a time and how many **Show more** adds; it is `9`, three full rows on desktop.

To add another filter, such as a country:

1. Add a `data-` attribute with the value to the card in `PostCard.astro`, next to `data-category` and `data-tags`.
2. Add a `<details data-filter-menu>` menu whose options carry `data-filter="country"` and `data-value="<slug>"`, with a `data-filter-label="country"` element in its pill, following the two already there.
3. Add the key to the `State` and `FilterKey` types and to `emptyLabels`.
4. Add the comparison to `matches`, which decides what every count, the empty state, and the pagination see.
5. Add the parameter to `stateFromUrl` and `writeUrl`, and clear it in the **Clear filters** handler.

## Article Pages

[src/pages/blog/[slug].astro](./src/pages/blog/[slug].astro) assembles the reading page from the frontmatter:

- **The header** has breadcrumbs, the title, the excerpt as a standfirst, the date, the updated date, and the reading time.
- **The lead image** is the `thumbnail` at 16:9, wider than the text, with the `imageCredit` caption under it.
- **The reading column** is set in Newsreader at 18–20px, 37rem wide, which keeps lines near 70 characters. Pictures break out wider.
- **On this page** lists the body's `##` and `###` headings in a rail from `80rem`, and highlights the one being read. It appears when a post has at least two headings. Change the filter in [src/components/blog/TableOfContents.astro](./src/components/blog/TableOfContents.astro) to include `####`.
- **Tags** link to their tag pages.
- **Email sign-up**, [src/components/blog/SubscribeForm.astro](./src/components/blog/SubscribeForm.astro), follows the share row once `PUBLIC_TURNSTILE_SITE_KEY` is set at build time. Without the key, neither the form nor its script is on the page. See [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md).
- **The share sheet**, [src/components/blog/ShareSheet.astro](./src/components/blog/ShareSheet.astro), is a native `<dialog>` opened by the Share buttons in the byline and at the end of the article, or by any element with `data-share-open`. It lists seven services, with Bluesky, Mastodon, Reddit, and Pinterest behind **More**, and a copy-link field. Every target is a plain link built from the canonical URL, so no third-party script is loaded. Add or reorder entries in `targets` and `extraTargets`. The Share buttons are hidden without JavaScript.
- **Previous and next** follow publication order across the whole journal: Previous is the older post, Next the newer one.
- **Keep reading** shows three related posts, scored in `getRelatedPosts` in [src/lib/posts.ts](./src/lib/posts.ts): two points for sharing the topic, one for each shared tag, newest first on a tie.
- **The progress bar** is the accent hairline at the top of the viewport.

There are no comments. To add them, place your provider's embed in `[slug].astro`, for example after the share row; most providers key a thread by the page URL or `post.slug`. Load its script only on article pages, and mention it in your privacy notice.

## Prose and Code

The article body is styled by the `prose-article` utility in [src/styles/global.css](./src/styles/global.css): paragraphs, `##` and `###` headings, lists, links, blockquotes set as large italic pull quotes, images, captions, horizontal rules set as three dots, inline code, code blocks, and callouts. It works on any element, such as body copy on the About page.

A callout is a tinted aside, written as HTML in the MDX:

```mdx
<div class="callout">A short aside, set apart from the text around it.</div>
```

Code blocks are highlighted at build time by Shiki with the `github-light` and `everforest-dark` themes, set in `markdown.shikiConfig` in [astro.config.mjs](./astro.config.mjs). The block background is the `--surface` token in light mode and `--canvas` in dark mode, where the dark theme's comments need the deeper ground. Every code block in an article gets a copy button, added by the script at the end of `[slug].astro`; it appears on hover or keyboard focus.

## Images

Every image a post uses lives in the post's own folder, next to its `index.mdx`, and goes through Astro's image pipeline. `thumbnail` is an `image()` in the schema, so it must be a local file; a remote URL fails validation.

**Pictures in the body.** Drop the file into the post folder and write ordinary Markdown:

```md
![A spool of waxed linen thread beside a steel ruler.](./binding-thread.jpg)
```

It is optimized at build time, set to the reading column's width, and opens in the lightbox when clicked. The alt text doubles as the lightbox caption.

**Pictures with a caption.** Use `Figure`, which every MDX post can use without importing the component. Import the image itself at the top of the post, below the frontmatter:

```mdx
import printedPage from "./printed-page.jpg";

<Figure
  src={printedPage}
  alt="Close-set lines of printed text on the page of an open book."
  caption="A narrow measure, set close and read slowly."
  credit="Photo by Brett Jordan on Unsplash"
  creditUrl="https://unsplash.com/photos/LtDiekEGH0Y"
  width="wide"
/>
```

`alt` is required; `caption`, `credit`, and `creditUrl` are optional; `width="wide"` lets the picture break out of the reading column on large screens. The lightbox opens a full-size rendition, up to 2400 pixels wide.

**The lightbox** is [src/components/blog/Lightbox.astro](./src/components/blog/Lightbox.astro), a native `<dialog>` included on every article page. Every body image in a post joins one set, in reading order: the arrows (hidden on phones, where you swipe instead), the `←` and `→` keys, and a swipe step through it, and a counter shows the position. It closes with the close button, `Escape`, or a click outside the picture, and focus returns to the image that opened it. The cover image is not part of the set.

**Covers.**

- Use covers at least 1600 pixels wide. The article shows them at 16:9 and cards at 3:2, cropped from the center.
- Each place requests its own sizes, from 320 to 1600 pixels wide. The article's lead image loads eagerly with high priority; card images load lazily.
- Cards show the cover with empty alt text, since the headline beside it carries the meaning. `thumbnailAlt` is used on the article page.
- Every post's social card is a 1200x630 crop of its cover, generated at build time in [src/layouts/BaseLayout.astro](./src/layouts/BaseLayout.astro). Every other page uses `siteConfig.socialImage`, `/og-image.png`, a 1200x630 image in `public/`: a plain type card with the site name and description, which you can replace with a photograph of your own.

## Icons

Interface icons are SVG files in [src/icons/lucide](./src/icons/lucide) (Lucide) and brand marks in [src/icons/bootstrap](./src/icons/bootstrap) (Bootstrap Icons), rendered by [src/components/ui/Icon.astro](./src/components/ui/Icon.astro):

```astro
<Icon name="arrow-right" class="size-4" />
<Icon name="social-github" class="size-4" />
```

To add an icon, save its SVG from [lucide.dev](https://lucide.dev/) into `src/icons/lucide` and use its file name, or save a brand mark from [icons.getbootstrap.com](https://icons.getbootstrap.com/) into `src/icons/bootstrap` and use it as `social-<file name>`. A name with no matching file throws an error and stops the build, so a missing icon never ships as a blank square.

## Following and Contact

Readers follow the journal through the RSS feed, linked in the footer of every page and on the Contact page, and found by feed readers through the `<link rel="alternate">` tag in every page's head. They reach you through the profiles in `siteConfig.socials`, shown in the footer and on the Contact page, and through `siteConfig.email` once you set it. There is no contact form.

The only form that sends anything is the email sign-up at the end of each post, which stores addresses in Cloudflare D1 with double opt-in and sends confirmation emails through Resend. It stays closed until its production setup is done and `subscriptions.enabled` is `true`; [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md) covers setup, exporting the list, and unsubscribing. The privacy notice, [src/pages/privacy.astro](./src/pages/privacy.astro), says what the list stores and why; the form and the footer link to it.

## Routes

Every URL ends with a trailing slash (`trailingSlash: "always"` in `astro.config.mjs`). Keep internal links in that form; in development a link without the slash returns a 404.

| Page         | Source                                                                   | URL                   |
| ------------ | ------------------------------------------------------------------------ | --------------------- |
| Home         | [src/pages/index.astro](./src/pages/index.astro)                         | `/`                   |
| Journal      | [src/pages/blog/index.astro](./src/pages/blog/index.astro)               | `/blog/`              |
| Article      | `src/pages/blog/[slug].astro`                                            | `/blog/<slug>/`       |
| Topics       | [src/pages/categories/index.astro](./src/pages/categories/index.astro)   | `/categories/`        |
| Topic        | `src/pages/categories/[slug].astro`                                      | `/categories/<slug>/` |
| Tags         | [src/pages/tags/index.astro](./src/pages/tags/index.astro)               | `/tags/`              |
| Tag          | `src/pages/tags/[slug].astro`                                            | `/tags/<slug>/`       |
| Apps         | [src/pages/apps/index.astro](./src/pages/apps/index.astro)               | `/apps/`              |
| About        | [src/pages/about.astro](./src/pages/about.astro)                         | `/about/`             |
| Contact      | [src/pages/contact.astro](./src/pages/contact.astro)                     | `/contact/`           |
| Privacy      | [src/pages/privacy.astro](./src/pages/privacy.astro)                     | `/privacy/`           |
| Not found    | [src/pages/404.astro](./src/pages/404.astro)                             | `/404.html`           |
| Feed         | [src/pages/rss.xml.ts](./src/pages/rss.xml.ts)                           | `/rss.xml`            |
| Search index | [src/pages/search-index.json.ts](./src/pages/search-index.json.ts)       | `/search-index.json`  |
| Robots       | [src/pages/robots.txt.ts](./src/pages/robots.txt.ts)                     | `/robots.txt`         |
| Sitemap      | generated by `@astrojs/sitemap`                                          | `/sitemap-index.xml`  |
| Sign-up      | [src/pages/api/subscribe.ts](./src/pages/api/subscribe.ts)               | `/api/subscribe/`     |
| Confirm      | [src/pages/subscribe/confirm.astro](./src/pages/subscribe/confirm.astro) | `/subscribe/confirm/` |
| Unsubscribe  | [src/pages/unsubscribe.astro](./src/pages/unsubscribe.astro)             | `/unsubscribe/`       |

Every route is prerendered except `robots.txt` and the last three, which render on request in the Worker (`export const prerender = false`). The confirm and unsubscribe pages are `noindex` and left out of the sitemap.

Topic and tag pages list every post they hold on one page. If a topic outgrows that, add Astro's `paginate` to its route.

## Theme Tokens

Colors, shadows, the header height, the gutter, and the page width are CSS custom properties at the top of [src/styles/global.css](./src/styles/global.css), defined once in `:root` and again for dark mode in `:root.dark`:

```css
:root {
  --canvas: #e9e1d2;
  --surface: #f7f4ed;
  --sunken: #e0d7c5;
  --line: #d6cbb6;
  --line-strong: #c9bca4;
  --ink: #34372d;
  --body: #43463a;
  --muted: #5b5e48;
  --accent: #8f5233;
  --accent-soft: #f0e2d6;
  --inverse: #34372d;
  --on-inverse: #f7f4ed;
  /* ... */
}
```

The light palette is warm sand and linen with forest-charcoal text and a terracotta accent; the dark palette is olive-charcoal with warm paper text and an olive accent. Both accents are adjusted so text in them meets WCAG AA. To rebrand, change `--accent` and `--accent-soft` in both blocks. The accent marks links, focus rings, the reading progress bar, and hover states. Primary buttons use `--inverse` and `--on-inverse`, not the accent. Update the color in [public/favicon.svg](./public/favicon.svg) to match, and the two `theme-color` tags in `BaseLayout.astro`, which follow `--canvas`.

The tokens are also Tailwind colors, so `bg-canvas`, `bg-surface`, `bg-sunken`, `border-line`, `text-ink`, `text-body`, `text-muted`, and `text-accent` work in markup. The type scale (`text-display`, `text-headline`, `text-section`, `text-title`, `text-lead`) and the radii (`rounded-card`, `rounded-panel`) are defined in the `@theme` block of the same file.

Shared pieces such as `.shell`, `.serif`, `.btn`, `.chip`, `.meta`, `.media`, `.field`, and the archive's filter styles are in the components layer of `global.css`.

## Fonts

Newsreader, Geist, and Geist Mono are self-hosted in [public/fonts](./public/fonts) and declared at the top of `global.css`:

- **Newsreader**, `--font-serif`, sets everything written for the reader: headlines, standfirsts, the reading column, excerpts, author bios, and captions (in italic). It is bundled in roman and italic, each split into Latin, Latin Extended, and Vietnamese files that load only when a page needs them.
- **Geist**, `--font-sans`, sets the interface: navigation, dates and reading times, topic labels, buttons, forms, and counts.
- **Geist Mono**, `--font-mono`, sets code only, so it loads only on pages with code.

All three are variable fonts with `font-display: swap`. Newsreader's Latin roman and Geist are preloaded in `BaseLayout.astro`, since they carry everything above the fold.

To change them, replace the files, update the `@font-face` rules, set `--font-sans`, `--font-serif`, and `--font-mono` in the `@theme` block, update the preloaded files in `BaseLayout.astro`, and edit the "Set in" line in `SiteFooter.astro`.

## Light and Dark Mode

The site follows the reader's system setting until they press the theme toggle; their choice is then remembered in `localStorage` under `diary-theme`. The script in [src/layouts/BaseLayout.astro](./src/layouts/BaseLayout.astro) applies the mode before the first paint, so there is no flash.

Dark mode is the `dark` class on `<html>`. Use the `dark:` variant in markup, or `.dark` in CSS. The toggle is hidden without JavaScript, when the system setting decides.

## Motion

Page headers rise in on load: add `rise` to an element to opt it in, and `style="--rise-order: 2"` to stagger it. Cards zoom their image slightly on hover, and the search palette fades in. All of it is CSS, and all of it stops when the reader prefers reduced motion.

## SEO and Structured Data

[src/layouts/BaseLayout.astro](./src/layouts/BaseLayout.astro) writes the document head from the props each page passes:

| Prop             | Purpose                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `title`          | The page title, suffixed with the site name                            |
| `description`    | The meta description and both social descriptions                      |
| `image`          | An imported image, cropped to a 1200x630 social card, or a public path |
| `imageAlt`       | Alt text for the social image                                          |
| `type`           | `website`, `article`, or `profile` for Open Graph                      |
| `canonical`      | Overrides the canonical URL                                            |
| `noindex`        | Adds `noindex, follow`; the 404 page uses it                           |
| `publishedTime`  | `article:published_time`                                               |
| `modifiedTime`   | `article:modified_time`                                                |
| `structuredData` | The page's JSON-LD; pages without it get the `WebSite` schema          |

- Every page has a canonical URL, Open Graph and Twitter/X tags, and JSON-LD. The schemas are built with the helpers in [src/lib/schema.ts](./src/lib/schema.ts): `WebSite` with a `SearchAction` on the homepage, `BlogPosting` on articles with `siteConfig.author` as its author and publisher, `CollectionPage` on the journal and the topic and tag pages, and `AboutPage` and `ContactPage`. Every page below the homepage adds a `BreadcrumbList` matching its visible breadcrumbs.
- `/rss.xml` lists every published post, newest first, with its excerpt, the author's name, and its topic.
- `/sitemap-index.xml` is generated by `@astrojs/sitemap`, and `/robots.txt` points to it. `robots.txt` is rendered on request by [src/lib/robots.ts](./src/lib/robots.ts): it allows crawling only on the exact origin in `siteUrl` and disallows everything on other hosts, such as the Worker's `workers.dev` URL, preview URLs, `www.`, and plain `http`, so they don't compete with the real site. `/api/` is disallowed everywhere.

## Deployment

The site is a Cloudflare Worker, built with the `@astrojs/cloudflare` adapter: `npm run build` writes the prerendered pages to `dist/client` and the Worker to `dist/server`, and `npx wrangler deploy` uploads both. [wrangler.jsonc](./wrangler.jsonc) holds the Worker's name (`diaryfromtheroad`), its `workers.dev` setting, the static-asset settings, the `SUBSCRIBERS_DB` binding (commented out until subscriptions are enabled), and the `EMAIL_FROM` sender; secrets are set with `npx wrangler secret put`, never in the file. A small integration in `astro.config.mjs` deletes the copy of `.dev.vars` that Cloudflare's Vite plugin writes into `dist/server`. In [astro.config.mjs](./astro.config.mjs), `session: false` and `imageService: "compile"` keep the adapter from adding a KV namespace or a Cloudflare Images binding. The adapter does not support Cloudflare Pages, and the sign-up routes need the Worker, so the site no longer works on a static-only host.

## Before Launch

- `siteConfig.siteUrl` is `https://diaryfromtheroad.com`. Connect the domain (README.md, Connecting diaryfromtheroad.com), then confirm a page's canonical tag and `/robots.txt` on it.
- Check `siteConfig.author.name`, and add your email to `siteConfig.email` in `src/config/site.ts` if you want it on the Contact page and in the footer.
- Add your posts to `src/content/blog`; see its README.
- Replace the tags in `src/config/taxonomy.ts` with the ones you publish under.
- Write the About page.
- Replace `public/favicon.svg` (a stand-in monogram), and, if you like, `public/og-image.png` with a photograph of your own.
- Before opening email sign-up, follow [Setting up production](./SUBSCRIPTIONS.md#setting-up-production): the D1 database ID in `wrangler.jsonc`, Turnstile, a verified sending domain in Resend, `EMAIL_FROM`, and the two secrets. Then set `subscriptions.enabled` to `true`, and check that the privacy notice still matches.
