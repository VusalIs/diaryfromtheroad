import type { APIRoute } from "astro";
import { handleResendWebhook } from "@/lib/subscriptions";
import { getWebhookSetup } from "@/lib/subscriptions-env";

/* Resend posts bounces and spam reports here (SUBSCRIPTIONS.md); rendered on request by the Worker. */
export const prerender = false;

export const POST: APIRoute = ({ request }) => {
  const setup = getWebhookSetup();
  if (!setup) return new Response(null, { status: 503 });
  return handleResendWebhook(request, setup);
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
