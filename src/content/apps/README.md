# Apps

Each app is a folder here, named for its anchor on the Apps page, holding an `index.md` and its images:

```text
src/content/apps/your-app/
|-- index.md
|-- logo.png
|-- screenshot-1.png
`-- screenshot-2.png
```

`src/content/apps/your-app/` becomes the section at `/apps/#your-app`, and the homepage lists every app below the posts, linking there. This README is never published; only files named `index.md` or `index.mdx` become apps.

## Frontmatter

```yaml
---
name: "" # the app's name
summary: "" # one or two sentences, shown on the Apps page and the homepage
logo: ./logo.png # optional, a square image at least 256px wide
appStore: "" # optional, the App Store URL
links: [] # optional, e.g. [{ label: "Website", url: "https://…" }]
status: "" # optional, your own words, shown as a small label
platforms: [] # optional, e.g. ["iOS"]
screenshots: # optional, up to four, shown in this order
  - src: ./screenshot-1.png
    alt: "" # what the screenshot shows, for screen readers
order: 0 # lower numbers come first; ties sort by name
draft: true # true keeps it off the site
---
```

Anything written below the frontmatter appears under the summary on the Apps page. The schema is in [src/content.config.ts](../../content.config.ts); a missing name or summary, or a link that is not a full URL, fails the build.

## Images

- Keep the logo and screenshots in the app's folder, not `public/`, so they are resized and served as WebP.
- Use screenshots straight from the device or App Store Connect. They are shown whole, never cropped, and open full size when tapped.
