import type { APIRoute } from "astro";
import { siteConfig } from "@/config/site";
import { robotsTxt } from "@/lib/robots";

/* Rendered on request, so it can tell siteUrl's host from the other addresses the Worker answers
   on. Until diaryfromtheroad.com is connected, the site runs on its workers.dev URL, which is
   therefore kept out of search engines. */
export const prerender = false;

export const GET: APIRoute = ({ url }) =>
  new Response(robotsTxt(url, siteConfig.siteUrl), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
