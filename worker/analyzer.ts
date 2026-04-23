// does the deterministic part of a scan
// fetches the site, times it, checks security headers, pulls basic seo from html,
// runs a small accessibility audit, inspects tls, and samples for broken links
// the ai layer reads the output of this file, so keep it stable and json-friendly

import { ssrfReason } from "./security";

// shape of one security header check result
export interface SecurityHeaderCheck {
  header: string;
  present: boolean;
  value: string | null;
  severity: "high" | "medium" | "low";
  description: string;
}

// one accessibility issue found on the page
export interface A11yIssue {
  id: string;
  severity: "high" | "medium" | "low";
  message: string;
}

// one broken link sampled from the page
export interface LinkCheck {
  url: string;
  status: number;
  ok: boolean;
}

// the full raw scan object we hand to the ai
export interface ScanRaw {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  ttfbMs: number;
  totalMs: number;
  htmlBytes: number;
  contentType: string | null;
  server: string | null;
  security: {
    headers: SecurityHeaderCheck[];
    missingCount: number;
  };
  performance: {
    ttfbMs: number;
    totalMs: number;
    htmlBytes: number;
    estimatedAssetCount: number;
    compression: string | null;
  };
  seo: {
    title: string | null;
    titleLength: number;
    metaDescription: string | null;
    metaDescriptionLength: number;
    h1Count: number;
    h2Count: number;
    hasViewport: boolean;
    hasCanonical: boolean;
    hasOgTitle: boolean;
    hasOgDescription: boolean;
    lang: string | null;
  };
  // accessibility audit result
  accessibility: {
    score: number; // 0..100 quick heuristic
    issues: A11yIssue[];
    imagesMissingAlt: number;
    totalImages: number;
    headingOrderOk: boolean;
  };
  // tls / network info pulled from request.cf when available
  tls: {
    protocol: string | null;
    cipher: string | null;
    httpVersion: string | null;
    country: string | null;
    colo: string | null;
  };
  // small sample of broken links found on the home page
  links: {
    sampled: number;
    broken: LinkCheck[];
  };
  error?: string;
}

// shape of what we gather during one scan, kept small on purpose
interface ScanOptions {
  // skip broken-link probes, used by tests or low-cost scans
  checkLinks?: boolean;
}

// list of security headers we care about + why they matter
const SECURITY_HEADERS: Array<Omit<SecurityHeaderCheck, "present" | "value">> = [
  {
    header: "content-security-policy",
    severity: "high",
    description:
      "Controls which resources the browser is allowed to load. Missing CSP greatly increases XSS risk.",
  },
  {
    header: "strict-transport-security",
    severity: "high",
    description:
      "Forces HTTPS. Without HSTS, users can be downgraded to HTTP on first visit.",
  },
  {
    header: "x-frame-options",
    severity: "medium",
    description: "Prevents clickjacking by disallowing the site from being framed.",
  },
  {
    header: "x-content-type-options",
    severity: "medium",
    description: "Stops MIME sniffing; should be 'nosniff'.",
  },
  {
    header: "referrer-policy",
    severity: "low",
    description: "Limits how much referrer info leaks to third parties.",
  },
  {
    header: "permissions-policy",
    severity: "low",
    description:
      "Restricts which browser features (camera, mic, geolocation, etc.) the page can use.",
  },
];

// hard caps so a hostile site cannot exhaust our worker
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB cap on html body
const LINK_SAMPLE_LIMIT = 10;
const LINK_CHECK_TIMEOUT_MS = 5_000;

// add https:// if the user didn't type it
function normalizeUrl(raw: string): string {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// quick sanity check before we make an agent for this url
// also blocks internal / metadata hosts (ssrf protection)
export function isValidUrl(raw: string): boolean {
  try {
    const u = normalizeUrl(raw);
    // ssrfReason returns null when the url is safe
    return ssrfReason(u) === null;
  } catch {
    return false;
  }
}

// counts how many times a regex hits in a string
function countMatches(html: string, re: RegExp): number {
  return (html.match(re) || []).length;
}

// pull a meta tag value by name or property, both attribute orders
function pickMeta(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`,
    "i",
  );
  const m = html.match(re) || html.match(alt);
  return m ? m[1] : null;
}

// read up to MAX_BYTES from a response body to avoid memory blowups
async function readBodyCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // we already have what we need, ignore
      }
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concat(chunks));
}

// glue Uint8Array chunks together into one buffer
function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

// fetch with a hard timeout, so a slow origin cannot hang the worker
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// pull the first N same-origin links out of the html for a broken-link probe
function extractInternalLinks(html: string, origin: string, limit: number): string[] {
  const links = new Set<string>();
  const re = /<a[^>]+href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && links.size < limit) {
    const href = m[1];
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue;
    try {
      const u = new URL(href, origin);
      // skip non-http and cross-origin
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (u.origin !== origin) continue;
      // ssrf guard in case the site links to something like 127.0.0.1
      if (ssrfReason(u.toString())) continue;
      links.add(u.toString());
    } catch {
      // skip malformed hrefs
    }
  }
  return Array.from(links);
}

// probe a list of links with HEAD (fallback to GET) and return any 4xx/5xx
async function checkLinks(urls: string[]): Promise<LinkCheck[]> {
  const results = await Promise.all(
    urls.map(async (u) => {
      try {
        let res = await fetchWithTimeout(
          u,
          { method: "HEAD", redirect: "follow" },
          LINK_CHECK_TIMEOUT_MS,
        );
        // some servers reject HEAD, retry once with a range GET
        if (res.status === 405 || res.status === 501) {
          res = await fetchWithTimeout(
            u,
            { method: "GET", redirect: "follow", headers: { range: "bytes=0-0" } },
            LINK_CHECK_TIMEOUT_MS,
          );
        }
        return { url: u, status: res.status, ok: res.ok };
      } catch {
        return { url: u, status: 0, ok: false };
      }
    }),
  );
  // only return broken ones, the full count is reported separately
  return results.filter((r) => !r.ok);
}

// quick accessibility heuristic based on the raw html
// not a full axe audit, but catches the common stuff and is zero cost
function runA11y(html: string, seoLang: string | null): ScanRaw["accessibility"] {
  const issues: A11yIssue[] = [];

  // images without an alt attribute
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const imagesMissingAlt = imgTags.filter((t) => !/\balt=/i.test(t)).length;
  if (imagesMissingAlt > 0) {
    issues.push({
      id: "img-alt",
      severity: "high",
      message: `${imagesMissingAlt} image(s) missing alt text.`,
    });
  }

  // document language
  if (!seoLang) {
    issues.push({
      id: "html-lang",
      severity: "medium",
      message: "<html> element is missing a lang attribute.",
    });
  }

  // buttons / links with no discernible text
  const emptyButtons = (
    html.match(/<button[^>]*>\s*<\/button>/gi) ?? []
  ).length;
  if (emptyButtons > 0) {
    issues.push({
      id: "empty-button",
      severity: "medium",
      message: `${emptyButtons} button(s) with no visible text.`,
    });
  }

  // heading order: very rough check that h1 appears before any h2/h3
  const headingOrderOk = (() => {
    const firstH1 = html.search(/<h1\b/i);
    const firstH2 = html.search(/<h2\b/i);
    if (firstH1 < 0 || firstH2 < 0) return true;
    return firstH1 < firstH2;
  })();
  if (!headingOrderOk) {
    issues.push({
      id: "heading-order",
      severity: "low",
      message: "<h2> appears before <h1>; headings should be in document order.",
    });
  }

  // landmark: look for something that indicates a main landmark
  const hasMain = /<main\b/i.test(html) || /role=["']main["']/i.test(html);
  if (!hasMain) {
    issues.push({
      id: "main-landmark",
      severity: "low",
      message: "No <main> element or role=\"main\" landmark found.",
    });
  }

  // score is 100 minus weighted penalties for each issue
  const weight = { high: 25, medium: 10, low: 5 } as const;
  const penalty = issues.reduce((acc, i) => acc + weight[i.severity], 0);

  return {
    score: Math.max(0, 100 - penalty),
    issues,
    imagesMissingAlt,
    totalImages: imgTags.length,
    headingOrderOk,
  };
}

// pull tls info from the response's cf object, which cloudflare fills in
function readTls(res: Response): ScanRaw["tls"] {
  const cf: any = (res as any).cf ?? {};
  return {
    protocol: cf.tlsVersion ?? null,
    cipher: cf.tlsCipher ?? null,
    httpVersion: cf.httpProtocol ?? null,
    country: cf.country ?? null,
    colo: cf.colo ?? null,
  };
}

// main scan function, called by the durable object
export async function runScan(
  rawUrl: string,
  opts: ScanOptions = { checkLinks: true },
): Promise<ScanRaw> {
  const url = normalizeUrl(rawUrl);

  // refuse to scan private / internal endpoints
  const blocked = ssrfReason(url);
  if (blocked) return emptyScan(url, blocked);

  // start a timer so we can report ttfb
  const startedAt = Date.now();

  // try to fetch the page with a hard timeout, bail out cleanly if it fails
  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        redirect: "follow",
        headers: {
          "user-agent":
            "SiteGuardianBot/1.0 (+https://github.com/; Cloudflare Workers AI)",
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        cf: { cacheTtl: 0, cacheEverything: false },
      },
      FETCH_TIMEOUT_MS,
    );
  } catch (err: any) {
    return emptyScan(url, err?.message ?? "fetch failed");
  }

  // copy headers into a plain object for easy lookup
  const headersObj: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    headersObj[k.toLowerCase()] = v;
  });

  // ttfb is measured right after the response arrives
  const ttfbMs = Date.now() - startedAt;
  // only download html, not binary stuff, and cap the size
  const ct = response.headers.get("content-type") ?? "";
  const html = ct.includes("text/") ? await readBodyCapped(response) : "";
  const totalMs = Date.now() - startedAt;
  const htmlBytes = new TextEncoder().encode(html).length;

  // check each security header we care about
  const securityHeaders: SecurityHeaderCheck[] = SECURITY_HEADERS.map((h) => {
    const value = headersObj[h.header] ?? null;
    return {
      header: h.header,
      present: value !== null,
      value,
      severity: h.severity,
      description: h.description,
    };
  });

  // grab the seo signals we care about from the html
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const metaDescription = pickMeta(html, "description");
  const ogTitle = pickMeta(html, "og:title");
  const ogDescription = pickMeta(html, "og:description");
  const lang = html.match(/<html[^>]*\slang=["']([^"']+)["']/i)?.[1] ?? null;

  // rough guess of how many sub-requests the page would make
  const estimatedAssetCount =
    countMatches(html, /<script\b/gi) +
    countMatches(html, /<link[^>]+rel=["']stylesheet["']/gi) +
    countMatches(html, /<img\b/gi);

  // accessibility audit
  const accessibility = runA11y(html, lang);

  // tls + network info
  const tls = readTls(response);

  // broken link sample, only if enabled and the fetch succeeded
  const finalUrl = response.url || url;
  let links: ScanRaw["links"] = { sampled: 0, broken: [] };
  if (opts.checkLinks && response.ok && html) {
    try {
      const origin = new URL(finalUrl).origin;
      const sampled = extractInternalLinks(html, origin, LINK_SAMPLE_LIMIT);
      const broken = sampled.length ? await checkLinks(sampled) : [];
      links = { sampled: sampled.length, broken };
    } catch {
      // leave links empty if anything blew up, not worth failing the scan over
    }
  }

  // return the big structured scan object
  return {
    url,
    finalUrl,
    status: response.status,
    ok: response.ok,
    ttfbMs,
    totalMs,
    htmlBytes,
    contentType: response.headers.get("content-type"),
    server: response.headers.get("server"),
    security: {
      headers: securityHeaders,
      missingCount: securityHeaders.filter((h) => !h.present).length,
    },
    performance: {
      ttfbMs,
      totalMs,
      htmlBytes,
      estimatedAssetCount,
      compression: response.headers.get("content-encoding"),
    },
    seo: {
      title: title || null,
      titleLength: title.length,
      metaDescription,
      metaDescriptionLength: metaDescription?.length ?? 0,
      h1Count: countMatches(html, /<h1\b/gi),
      h2Count: countMatches(html, /<h2\b/gi),
      hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
      hasCanonical: /<link[^>]+rel=["']canonical["']/i.test(html),
      hasOgTitle: !!ogTitle,
      hasOgDescription: !!ogDescription,
      lang,
    },
    accessibility,
    tls,
    links,
  };
}

// used when the fetch blew up, so we still return something usable
function emptyScan(url: string, error: string): ScanRaw {
  return {
    url,
    finalUrl: url,
    status: 0,
    ok: false,
    ttfbMs: 0,
    totalMs: 0,
    htmlBytes: 0,
    contentType: null,
    server: null,
    security: { headers: [], missingCount: 0 },
    performance: {
      ttfbMs: 0,
      totalMs: 0,
      htmlBytes: 0,
      estimatedAssetCount: 0,
      compression: null,
    },
    seo: {
      title: null,
      titleLength: 0,
      metaDescription: null,
      metaDescriptionLength: 0,
      h1Count: 0,
      h2Count: 0,
      hasViewport: false,
      hasCanonical: false,
      hasOgTitle: false,
      hasOgDescription: false,
      lang: null,
    },
    accessibility: {
      score: 0,
      issues: [],
      imagesMissingAlt: 0,
      totalImages: 0,
      headingOrderOk: true,
    },
    tls: { protocol: null, cipher: null, httpVersion: null, country: null, colo: null },
    links: { sampled: 0, broken: [] },
    error,
  };
}

// deterministic fallback scoring so the ui always has numbers even if llm fails
export function heuristicScores(scan: ScanRaw): {
  performance: number;
  security: number;
  seo: number;
} {
  // site was unreachable, everything is zero
  if (!scan.ok) return { performance: 0, security: 0, seo: 0 };

  // perf score based on ttfb buckets
  const ttfb = scan.performance.ttfbMs;
  const perf =
    ttfb < 200 ? 100 : ttfb < 500 ? 90 : ttfb < 1000 ? 75 : ttfb < 2000 ? 55 : 30;

  // security score loses 15 points per missing header
  const missing = scan.security.missingCount;
  let security = Math.max(0, 100 - missing * 15);
  // also penalize weak tls protocols if we have the data
  if (scan.tls.protocol && /tls\s*1\.0|tls\s*1\.1/i.test(scan.tls.protocol)) {
    security = Math.max(0, security - 20);
  }

  // seo score starts at 100 and we subtract for each problem
  let seoScore = 100;
  if (!scan.seo.title) seoScore -= 25;
  else if (scan.seo.titleLength < 10 || scan.seo.titleLength > 65) seoScore -= 10;
  if (!scan.seo.metaDescription) seoScore -= 20;
  else if (
    scan.seo.metaDescriptionLength < 50 ||
    scan.seo.metaDescriptionLength > 160
  )
    seoScore -= 10;
  if (scan.seo.h1Count !== 1) seoScore -= 10;
  if (!scan.seo.hasViewport) seoScore -= 10;
  if (!scan.seo.hasCanonical) seoScore -= 5;
  if (!scan.seo.hasOgTitle) seoScore -= 5;

  return {
    performance: Math.round(perf),
    security: Math.round(security),
    seo: Math.max(0, Math.round(seoScore)),
  };
}
