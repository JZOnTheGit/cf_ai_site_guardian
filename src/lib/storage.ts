// tiny localStorage helper that remembers which agents the user has created
// data still lives in the durable object, this is just a bookmark list
//
// we cap the list at 20 so localStorage never gets huge

// shape of one row in the recent sites list
export interface RecentSite {
  agentId: string;
  url: string;
  firstSeenAt: number;
  lastVisitedAt: number;
}

// key used in localStorage
const KEY = "sg:recent-sites";
const MAX = 20;

// helper so any json parse error doesn't crash the app
function safeParse(raw: string | null): RecentSite[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isRecentSite) : [];
  } catch {
    return [];
  }
}

// type guard so we don't trust malformed stored data
function isRecentSite(v: any): v is RecentSite {
  return (
    v &&
    typeof v.agentId === "string" &&
    typeof v.url === "string" &&
    typeof v.firstSeenAt === "number" &&
    typeof v.lastVisitedAt === "number"
  );
}

// read the full list, newest first
export function getRecentSites(): RecentSite[] {
  if (typeof window === "undefined") return [];
  const list = safeParse(window.localStorage.getItem(KEY));
  return list.sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
}

// same normalization the worker used to apply to urls before per-user ids,
// so we can match what the user typed against what we stored previously
function normalizeUrl(raw: string): string {
  return raw.trim().toLowerCase().replace(/\/+$/, "");
}

// find a site we've already created on this device for this url, so re-pasting
// the same url returns the user to their existing agent instead of spawning a
// brand new one every time
export function findRecentByUrl(rawUrl: string): RecentSite | null {
  const needle = normalizeUrl(rawUrl);
  if (!needle) return null;
  const list = getRecentSites();
  return list.find((r) => normalizeUrl(r.url) === needle) ?? null;
}

// add or refresh a site in the list
export function rememberSite(entry: { agentId: string; url: string }): void {
  if (typeof window === "undefined") return;
  const list = getRecentSites();
  const now = Date.now();
  const existing = list.find((r) => r.agentId === entry.agentId);
  // either bump the existing row or create a new one
  if (existing) {
    existing.url = entry.url;
    existing.lastVisitedAt = now;
  } else {
    list.unshift({
      agentId: entry.agentId,
      url: entry.url,
      firstSeenAt: now,
      lastVisitedAt: now,
    });
  }
  // cap the list so localStorage stays small
  const trimmed = list.slice(0, MAX);
  window.localStorage.setItem(KEY, JSON.stringify(trimmed));
}

// remove one site from the list, does not touch server data
export function forgetSite(agentId: string): void {
  if (typeof window === "undefined") return;
  const list = getRecentSites().filter((r) => r.agentId !== agentId);
  window.localStorage.setItem(KEY, JSON.stringify(list));
}
