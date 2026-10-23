export interface Term {
  slug: string;
  name: string;
}

export interface Category extends Term {
  description: string;
}

/** Order matters: the homepage and footer list topics in this order. */
export const categories = [
  {
    slug: "travel",
    name: "Travel",
    description: "Travel and everyday life in Southeast Asia.",
  },
  {
    slug: "motorcycles",
    name: "Motorcycles",
    description: "Motorcycle journeys and exploration.",
  },
  {
    slug: "money",
    name: "Money",
    description: "Real spending and cost-of-living breakdowns.",
  },
  {
    slug: "remote-work",
    name: "Remote Work",
    description: "Remote work and life abroad.",
  },
  {
    slug: "building-things",
    name: "Building Things",
    description: "Building small software products and independent projects.",
  },
] as const satisfies readonly Category[];

export const tags = [
  { slug: "writing", name: "Writing" },
  { slug: "typography", name: "Typography" },
  { slug: "minimalism", name: "Minimalism" },
  { slug: "tools", name: "Tools" },
  { slug: "travel", name: "Travel" },
  { slug: "process", name: "Process" },
  { slug: "web", name: "Web" },
  { slug: "books", name: "Books" },
] as const satisfies readonly Term[];

export type CategorySlug = (typeof categories)[number]["slug"];
export type TagSlug = (typeof tags)[number]["slug"];
