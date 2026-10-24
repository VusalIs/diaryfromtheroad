/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

/* The Worker's bindings and variables. Typed loosely and checked where they are read, in
   src/lib/subscriptions-env.ts, because `wrangler types` would replace the DOM types the
   browser scripts rely on. */
declare module "cloudflare:workers" {
  export const env: Readonly<Record<string, unknown>>;
}

/* The Cloudflare adapter sets this on requests rendered by the Worker. */
declare namespace App {
  interface Locals {
    cfContext?: { waitUntil(promise: Promise<unknown>): void };
  }
}
