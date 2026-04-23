// shared security helpers used by the worker and the scanner
// covers: ssrf protection, request validation, and tiny rate limiter

// blocked hostname patterns (ssrf protection)
// we never want users to point the scanner at internal resources
// or at cloud metadata endpoints
const BLOCKED_HOSTNAMES = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /\.local$/i,
  /\.internal$/i,
  /^169\.254\./, // link-local + aws/gcp metadata
  /^10\./, // rfc1918
  /^172\.(1[6-9]|2\d|3[0-1])\./, // rfc1918
  /^192\.168\./, // rfc1918
  /^fd[0-9a-f]{2}:/i, // ipv6 ula
  /^fe80:/i, // ipv6 link-local
  /^::1$/, // ipv6 loopback
  /metadata\.google\.internal/i,
];

// returns null if safe, otherwise a short reason string
export function ssrfReason(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "invalid url";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "only http(s) urls are allowed";
  }
  const host = parsed.hostname;
  if (!host) return "missing hostname";
  for (const re of BLOCKED_HOSTNAMES) {
    if (re.test(host)) return `blocked internal host: ${host}`;
  }
  return null;
}

// 32 hex chars is the format of DurableObject idFromString
const HEX_ID_RE = /^[0-9a-f]{64}$/i;

// validates a durable object id string we received from a client
// rejects anything that wouldn't parse and gives a clear error
export function isValidAgentId(id: unknown): id is string {
  return typeof id === "string" && HEX_ID_RE.test(id);
}

// check the Origin header matches the Host on mutating requests
// stops cross-site post attacks (basic csrf defense)
export function isSameOrigin(request: Request): boolean {
  const method = request.method.toUpperCase();
  // GET/HEAD/OPTIONS don't change state, skip the check
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const origin = request.headers.get("origin");
  // server-to-server calls with no Origin header are allowed (like our cron)
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const h = request.headers.get("host");
    return h ? o.host === h : false;
  } catch {
    return false;
  }
}

// tiny validator so we don't need to pull in zod
// returns a typed value if valid, or throws
export function assertString(v: unknown, name: string, max = 2048): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new HttpError(400, `missing or invalid "${name}"`);
  }
  if (v.length > max) throw new HttpError(400, `"${name}" too long`);
  return v;
}

// similar for optional number within a range
export function assertOptionalNumber(
  v: unknown,
  name: string,
  min: number,
  max: number,
): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new HttpError(400, `"${name}" must be a number or null`);
  }
  if (v < min || v > max) {
    throw new HttpError(400, `"${name}" must be between ${min} and ${max}`);
  }
  return v;
}

// simple http error that the worker catches and turns into a json response
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------- rate limiter ----------
// very small in-memory sliding window, keyed by ip
// not cluster-safe (each Worker isolate keeps its own map) but it is
// good enough to stop casual abuse and does not need any binding
// for a stronger limiter, uncomment the rate_limiting binding in
// wrangler.toml (see README "optional integrations")

interface RateBucket {
  count: number;
  resetAt: number;
}

const BUCKETS = new Map<string, RateBucket>();
const WINDOW_MS = 60_000;

// check + record one hit for this ip + route combo
// throws HttpError 429 if over the limit
export function rateLimit(request: Request, route: string, limit: number) {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    "unknown";
  const key = `${ip}:${route}`;
  const now = Date.now();
  let b = BUCKETS.get(key);
  // fresh bucket or expired window
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    BUCKETS.set(key, b);
  }
  b.count++;
  if (b.count > limit) {
    const retryAfter = Math.ceil((b.resetAt - now) / 1000);
    throw new HttpError(429, `too many requests, retry in ${retryAfter}s`);
  }
  // housekeeping: drop the oldest buckets if the map grows too big
  if (BUCKETS.size > 500) {
    for (const [k, v] of BUCKETS) {
      if (v.resetAt < now) BUCKETS.delete(k);
    }
  }
}
