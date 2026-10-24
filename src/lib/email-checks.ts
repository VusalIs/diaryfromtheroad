/**
 * Checks that keep mistyped and throwaway addresses off the subscriber list (see SUBSCRIPTIONS.md).
 * `suggestEmail` also runs in the browser, to offer a fix while the reader is still typing.
 */

/** Large providers whose near misses are almost always typos. */
const COMMON_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "mail.ru",
  "yandex.ru",
  "zoho.com",
];

/** The number of single-character edits, including swapping two neighbours, between two strings. */
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

/**
 * The address with a likely typo in a common provider fixed, such as `gmial.com` or `gmail.con`
 * for `gmail.com`; `undefined` when nothing looks wrong.
 */
export function suggestEmail(email: string): string | undefined {
  const at = email.lastIndexOf("@");
  if (at < 1) return undefined;
  const local = email.slice(0, at);
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (domain.length < 3 || COMMON_DOMAINS.includes(domain)) return undefined;

  let best: { domain: string; distance: number } | undefined;
  for (const candidate of COMMON_DOMAINS) {
    const distance = editDistance(domain, candidate);
    // Short names leave little room: one edit apart is a typo, two might be a different domain.
    const allowed = candidate.length <= 8 ? 1 : 2;
    if (distance <= allowed && (!best || distance < best.distance)) {
      best = { domain: candidate, distance };
    }
  }
  return best && `${local}@${best.domain}`;
}

/**
 * Well-known throwaway inbox services, whose addresses stop working within hours. Forwarding and
 * alias services that people keep (Apple's Hide My Email, Firefox Relay, DuckDuckGo, SimpleLogin)
 * are fine and not listed. The list is short on purpose; add to it when one turns up.
 */
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "1secmail.com",
  "1secmail.net",
  "1secmail.org",
  "discard.email",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "getnada.com",
  "grr.la",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "mintemail.com",
  "moakt.com",
  "mohmal.com",
  "nada.email",
  "sharklasers.com",
  "spamgourmet.com",
  "temp-mail.io",
  "temp-mail.org",
  "tempail.com",
  "tempmail.com",
  "tempmail.net",
  "tempr.email",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.de",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

/** Whether the address belongs to a throwaway inbox service, or a subdomain of one. */
export function isDisposableEmail(email: string): boolean {
  const labels = email.slice(email.lastIndexOf("@") + 1).split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (DISPOSABLE_DOMAINS.has(labels.slice(i).join("."))) return true;
  }
  return false;
}

export type DomainCheck = "ok" | "missing" | "no-mail";

const DNS_URL = "https://cloudflare-dns.com/dns-query";

/**
 * Whether a domain can receive email, looked up through Cloudflare's DNS-over-HTTPS resolver:
 * `missing` if the domain doesn't exist, `no-mail` if it has neither mail servers nor an address
 * (or says outright that it takes no mail), `ok` otherwise. Any lookup failure counts as `ok`, so
 * a DNS hiccup never blocks a real reader.
 */
export async function checkMailDomain(
  domain: string,
  { fetch: send = fetch, timeout = 3000 }: { fetch?: typeof fetch; timeout?: number } = {},
): Promise<DomainCheck> {
  const lookup = async (type: "MX" | "A") => {
    const url = `${DNS_URL}?name=${encodeURIComponent(domain)}&type=${type}`;
    const response = await send(url, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) return undefined;
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) return undefined;
    const { Status, Answer } = result as { Status?: unknown; Answer?: unknown };
    const records = Array.isArray(Answer)
      ? Answer.filter(
          (record): record is { type: number; data: string } =>
            typeof record === "object" &&
            record !== null &&
            record.type === (type === "MX" ? 15 : 1) &&
            typeof record.data === "string",
        ).map((record) => record.data)
      : [];
    return { status: typeof Status === "number" ? Status : -1, records };
  };

  try {
    const mx = await lookup("MX");
    if (!mx) return "ok";
    // 3 is NXDOMAIN: no such domain.
    if (mx.status === 3) return "missing";
    if (mx.status !== 0) return "ok";
    // A "null MX" (preference 0, host ".") says the domain takes no email at all.
    const servers = mx.records.filter((record) => !/^0\s+\.$/.test(record.trim()));
    if (servers.length > 0) return "ok";
    if (mx.records.length > 0) return "no-mail";
    // Without MX records, mail goes to the domain's own address, if it has one.
    const a = await lookup("A");
    if (!a || a.status !== 0) return "ok";
    return a.records.length > 0 ? "ok" : "no-mail";
  } catch {
    return "ok";
  }
}
