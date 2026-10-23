import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { categories, tags } from "./config/taxonomy";

const slugs = <T extends { slug: string }>(list: readonly T[]) =>
  list.map((item) => item.slug) as [T["slug"], ...T["slug"][]];

const blog = defineCollection({
  loader: glob({
    pattern: "**/index.{md,mdx}",
    base: "./src/content/blog",
    generateId: ({ entry }) => entry.replace(/[\\/]index\.mdx?$/, "").replace(/\\/g, "/"),
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      excerpt: z.string(),
      seoTitle: z.string().optional(),
      seoDescription: z.string().optional(),
      canonical: z.url().optional(),
      date: z.coerce.date(),
      updated: z.coerce.date().optional(),
      readingTime: z.number().int().positive().optional(),
      category: z.enum(slugs(categories)),
      tags: z.array(z.enum(slugs(tags))).default([]),
      thumbnail: image(),
      thumbnailAlt: z.string(),
      imageCredit: z
        .object({
          caption: z.string().optional(),
          author: z.string(),
          authorUrl: z.url(),
          source: z.string().default("Unsplash"),
          sourceUrl: z.url(),
        })
        .optional(),
      featured: z.boolean().default(false),
      draft: z.boolean().default(false),
    }),
});

/** The apps on /apps/: one folder per app, holding an index.md and its logo and screenshots. */
const apps = defineCollection({
  loader: glob({
    pattern: "**/index.{md,mdx}",
    base: "./src/content/apps",
    generateId: ({ entry }) => entry.replace(/[\\/]index\.mdx?$/, "").replace(/\\/g, "/"),
  }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      summary: z.string(),
      logo: image().optional(),
      appStore: z.url().optional(),
      links: z.array(z.object({ label: z.string(), url: z.url() })).default([]),
      status: z.string().optional(),
      platforms: z.array(z.string()).default([]),
      screenshots: z
        .array(z.object({ src: image(), alt: z.string() }))
        .max(4)
        .default([]),
      order: z.number().default(0),
      draft: z.boolean().default(false),
    }),
});

export const collections = { blog, apps };
