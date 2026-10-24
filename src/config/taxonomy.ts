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

/** Threads that run across topics: places, and themes that come back. Only tags with posts get a page. */
export const tags = [
  { slug: "vietnam", name: "Vietnam" },
  { slug: "thailand", name: "Thailand" },
  { slug: "hanoi", name: "Hanoi" },
  { slug: "da-nang", name: "Da Nang" },
  { slug: "cost-of-living", name: "Cost of Living" },
  { slug: "budget-travel", name: "Budget Travel" },
  { slug: "living-abroad", name: "Living Abroad" },
  { slug: "side-projects", name: "Side Projects" },
] as const satisfies readonly Term[];

export type CategorySlug = (typeof categories)[number]["slug"];
export type TagSlug = (typeof tags)[number]["slug"];
