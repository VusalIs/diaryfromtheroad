/**
 * The robots.txt for one request. Only the exact origin of `siteUrl` (scheme and host, so not
 * `www.` or plain `http`) may be crawled; every other host the Worker answers on, such as its
 * workers.dev URL and preview URLs, is told to stay out. No host is trusted just because it
 * reached the Worker.
 */
export function robotsTxt(requestUrl: URL, siteUrl: string): string {
  const site = new URL(siteUrl);
  const lines =
    requestUrl.origin === site.origin
      ? [
          "User-agent: *",
          "Allow: /",
          "Disallow: /api/",
          "",
          `Sitemap: ${new URL("/sitemap-index.xml", site)}`,
        ]
      : ["User-agent: *", "Disallow: /"];
  return `${lines.join("\n")}\n`;
}
