export interface NavLink {
  label: string;
  href: string;
}

export interface SocialLink extends NavLink {
  /** A file name from `src/icons/bootstrap`, used as `social-<name>`. */
  icon: string;
}

export const siteConfig = {
  name: "Diary From the Road",
  title: "Diary From the Road",
  description:
    "Notes from the road on travel, motorcycles, money, remote work, and building things along the way.",
  // The canonical domain, without a trailing slash. Canonical URLs, Open Graph tags, the feed, the
  // sitemap, and the links in subscription emails use it, and only this host may be crawled.
  siteUrl: "https://diaryfromtheroad.com",
  language: "en",
  locale: "en_US",
  dateLocale: "en-US",
  socialImage: "/og-image.png",

  /** Used to estimate read time when a post has no `readingTime`. */
  wordsPerMinute: 220,

  /** The journal's single author: the feed's byline and the articles' structured data. */
  author: {
    name: "Vusal Ismayilov",
  },

  /** Shown in the footer and on the Contact page. Leave it empty and both email links are hidden. */
  email: "",

  /** Profiles shown in the footer and on the Contact page, e.g.
   *  `{ label: "GitHub", href: "https://github.com/you", icon: "github" }`. */
  socials: [
    { label: "Instagram", href: "https://www.instagram.com/diaryfromtheroad/", icon: "instagram" },
    { label: "X", href: "https://x.com/diaryfromroad", icon: "twitter-x" },
    { label: "Reddit", href: "https://www.reddit.com/user/caspian_drifter_728/", icon: "reddit" },
  ] satisfies SocialLink[],

  /**
   * Email sign-up for the weekly map (SUBSCRIPTIONS.md). Set `enabled` to false to close it again:
   * production builds then leave the forms out and the server refuses sign-ups. `npm run dev`
   * ignores it. `popup` adds the sign-up popup to indexable pages; set it to false to keep only
   * the form at the end of each post.
   */
  subscriptions: {
    enabled: true,
    popup: true,
  },
};

export const navigation: NavLink[] = [
  { label: "Journal", href: "/blog/" },
  { label: "Apps", href: "/apps/" },
  { label: "About", href: "/about/" },
  { label: "Contact", href: "/contact/" },
];

/** The footer's links: only what the header navigation doesn't already offer. */
export const footerLinks: NavLink[] = [
  { label: "RSS feed", href: "/rss.xml" },
  { label: "Privacy", href: "/privacy/" },
];
