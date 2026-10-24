// @ts-check
import { rm } from "node:fs/promises";
import { defineConfig, envField } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { siteConfig } from "./src/config/site.ts";

/**
 * Cloudflare's Vite plugin copies local variables (.dev.vars, or the .env files when there is no
 * .dev.vars) into dist/server/.dev.vars for `npm run preview`. Deploys never read that copy, so it
 * is deleted after each build to keep local secrets out of the build output.
 * @returns {import("astro").AstroIntegration}
 */
function dropLocalVariables() {
  /** @type {URL | undefined} */
  let serverDir;
  return {
    name: "drop-local-variables",
    hooks: {
      "astro:config:done": ({ config }) => {
        serverDir = config.build.server;
      },
      "astro:build:done": async () => {
        if (serverDir) await rm(new URL(".dev.vars", serverDir), { force: true });
      },
    },
  };
}

export default defineConfig({
  site: siteConfig.siteUrl,
  trailingSlash: "always",
  /* Pages stay prerendered; only the email-subscription routes render on request, on Cloudflare Workers.
     Images are still optimized at build time, so no Cloudflare Images binding is needed. */
  adapter: cloudflare({ imageService: "compile" }),
  /* Nothing uses Astro sessions, so the adapter provisions no KV namespace for them. */
  session: false,
  /* Email sign-up (SUBSCRIPTIONS.md). */
  env: {
    schema: {
      /* The Turnstile site key: public (it ends up in the page), read at build time, and accepted only on
         diaryfromtheroad.com. .env.development overrides it with Cloudflare's test key for `npm run dev`. */
      PUBLIC_TURNSTILE_SITE_KEY: envField.string({
        context: "client",
        access: "public",
        default: "0x4AAAAAAFjn1y199eU_DnSq",
      }),
      /* `access: "secret"` values are read from the Worker when a request is handled, never at build time. */
      TURNSTILE_SECRET_KEY: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
      RESEND_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      /* Not a secret: the verified sender, set in wrangler.jsonc `vars`. Read at runtime too. */
      EMAIL_FROM: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
  integrations: [
    mdx(),
    sitemap({
      filter: (page) =>
        !page.endsWith(".json") &&
        !page.endsWith(".xml") &&
        !page.endsWith(".txt") &&
        // Reached only from links in emails.
        !page.endsWith("/subscribe/confirm/") &&
        !page.endsWith("/unsubscribe/"),
    }),
    dropLocalVariables(),
  ],
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "everforest-dark" },
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
