import { getCollection, type CollectionEntry } from "astro:content";

export type App = CollectionEntry<"apps">;

let cache: App[] | undefined;

/** Listed apps in display order: `order`, then name. Drafts never leave this function. */
export const getApps = async (): Promise<App[]> => {
  if (!cache) {
    cache = (await getCollection("apps", ({ data }) => !data.draft)).sort(
      (a, b) => a.data.order - b.data.order || a.data.name.localeCompare(b.data.name),
    );
  }
  return cache;
};

/** Each app is a section of the Apps page, anchored by its folder name. */
export const appUrl = (app: Pick<App, "id">) => `/apps/#${app.id}`;
