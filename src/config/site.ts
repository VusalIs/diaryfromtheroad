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
  // TODO: set to the production domain before launch. Canonical URLs, the feed, and the sitemap use it.
  siteUrl: "https://quietpages.xocoweb.workers.dev",
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

  /**
   * POST endpoint for the contact form. Leave it empty and the form runs in demo mode:
   * it validates and confirms, but sends nothing.
   */
  forms: {
    contact: "",
  },

  /** Profiles shown in the footer and on the Contact page, e.g.
   *  `{ label: "GitHub", href: "https://github.com/you", icon: "github" }`. */
  socials: [] as SocialLink[],
};

export const navigation: NavLink[] = [
  { label: "Journal", href: "/blog/" },
  { label: "Topics", href: "/categories/" },
  { label: "About", href: "/about/" },
];

export const footerLinks: NavLink[] = [
  { label: "Archive", href: "/blog/" },
  { label: "Tags", href: "/tags/" },
  { label: "About", href: "/about/" },
  { label: "Contact", href: "/contact/" },
  { label: "RSS feed", href: "/rss.xml" },
];
