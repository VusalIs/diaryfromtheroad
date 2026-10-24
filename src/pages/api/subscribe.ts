import type { APIRoute } from "astro";
import { handleSubscribe, messages, reply } from "@/lib/subscriptions";
import { getOwnerNotifier, getSignupSetup } from "@/lib/subscriptions-env";

/* Rendered on request by the Worker; the rest of the site is prerendered. */
export const prerender = false;

export const POST: APIRoute = ({ request, url, locals }) => {
  const setup = getSignupSetup(url);
  if (!setup) return reply(503, messages.closed);
  const notify = getOwnerNotifier(setup.db);
  return handleSubscribe(request, {
    ...setup,
    remoteIp: request.headers.get("cf-connecting-ip") ?? undefined,
    // The note goes out after the reply, so the reader never waits for it.
    onSubscribed:
      notify &&
      ((email) => {
        const note = notify(email);
        if (locals.cfContext) locals.cfContext.waitUntil(note);
        else void note;
      }),
  });
};

export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
