import type { APIRoute } from "astro";
import { siteConfig } from "@/config/site";
import { handleSubscribe, messages, reply } from "@/lib/subscriptions";
import { getSignupSetup } from "@/lib/subscriptions-env";

/* Rendered on request by the Worker; the rest of the site is prerendered. */
export const prerender = false;

export const POST: APIRoute = ({ request, url }) => {
  const setup = getSignupSetup(url);
  if (!setup) return reply(503, messages.closed);
  return handleSubscribe(request, {
    ...setup,
    siteName: siteConfig.name,
    remoteIp: request.headers.get("cf-connecting-ip") ?? undefined,
  });
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
