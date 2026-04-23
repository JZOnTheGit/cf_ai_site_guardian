// does the deterministic part of a scan
// fetches the site, times it, checks security headers, pulls basic seo from html
// the ai layer reads the output of this file, so keep it stable and json-friendly

// shape of one security header check result
export interface SecurityHeaderCheck {
  header: string;
  present: boolean;
  value: string | null;
  severity: "high" | "medium" | "low";
  description: string;
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
  error?: string;
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

// add https:// if the user didn't type it
function normalizeUrl(raw: string): string {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// quick sanity check before we make an agent for this url
export function isValidUrl(raw: string): boolean {
  try {
    const u = new URL(normalizeUrl(raw));
    return u.protocol === "http:" || u.protocol === "https:";
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

// main scan function, called by the durable object
export async function runScan(rawUrl: string): Promise<ScanRaw> {
  const url = normalizeUrl(rawUrl);
  // start a timer so we can report ttfb
  const startedAt = Date.now();

  // try to fetch the page, bail out cleanly if it fails
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent":
          "SiteGuardianBot/1.0 (+https://github.com/; Cloudflare Workers AI)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
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
  // only download html, not binary stuff
  const html = response.headers.get("content-type")?.includes("text/")
    ? await response.text()
    : "";
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

  // return the big structured scan object
  return {
    url,
    finalUrl: response.url || url,
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
  const security = Math.max(0, 100 - missing * 15);

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
