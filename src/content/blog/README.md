# Posts

Each post is a folder here, named for its URL, holding an `index.mdx` (or `index.md`) and the photos it uses:

```text
src/content/blog/your-post-slug/
|-- index.mdx
|-- cover.jpg
`-- any-other-photo.jpg
```

`src/content/blog/your-post-slug/` is published at `/blog/your-post-slug/`. This README is never published; only files named `index.md` or `index.mdx` become posts.

## Frontmatter

```yaml
---
title: ""
excerpt: "" # one or two sentences: the standfirst, the card text, and the meta description
date: 2026-01-31 # publication date, YYYY-MM-DD
category: "travel" # travel, motorcycles, money, remote-work, or building-things
tags: [] # slugs from src/config/taxonomy.ts
thumbnail: ./cover.jpg # required, a photo in this folder
thumbnailAlt: "" # what the cover shows, for screen readers
featured: false # true makes it the homepage's lead post
draft: true # true keeps it off every page, the feed, search, and the sitemap
---
```

Optional fields: `updated`, `readingTime`, `seoTitle`, `seoDescription`, `canonical`, and `imageCredit`, which prints "Photo by … on …" under the cover and is only for someone else's photograph. The schema is in [src/content.config.ts](../../content.config.ts); a post with a missing or unknown value fails the build.

## Photos

- Keep photos in the post's folder, not `public/`, so they are resized and served as WebP.
- Export JPEG in sRGB at about 2400px on the long edge. Larger files only slow the build.
- Remove GPS location data before committing. The published images drop it, but the originals in git keep it.
- Keep the subject near the middle: covers are cropped from the center to 16:9, 3:2, and 4:3.
- In the body, use `![Alt text](./photo.jpg)`, or `<Figure>` for a caption (see CUSTOMIZATION.md).

With no posts, the homepage shows only its introduction; it adds the lead post, the post grid, and the topic list as posts are published.
