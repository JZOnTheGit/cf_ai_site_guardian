// list of the user's previously monitored sites, pulled from localStorage
// shown on the landing page so users don't lose their agent links
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { forgetSite, getRecentSites, type RecentSite } from "../lib/storage";

// turn a timestamp into a short "5m ago" / "2d ago" label
function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// strip the protocol for a cleaner display
function prettyUrl(u: string): string {
  return u.replace(/^https?:\/\//, "");
}

export function RecentSites() {
  // hydrate from localStorage after mount so ssr stays clean
  const [sites, setSites] = useState<RecentSite[]>([]);
  useEffect(() => {
    setSites(getRecentSites());
  }, []);

  // nothing to show on a fresh browser
  if (sites.length === 0) return null;

  // remove one site from the list without touching server data
  function onForget(id: string) {
    forgetSite(id);
    setSites(getRecentSites());
  }

  return (
    <section className="mx-auto mt-16 w-full max-w-3xl text-left">
      {/* section header */}
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 className="text-sm font-semibold text-ink-700">Your monitored sites</h2>
        <span className="text-xs text-ink-400">
          stored in this browser - data lives on Cloudflare
        </span>
      </div>

      {/* list of recent sites */}
      <ul className="card divide-y divide-ink-100 overflow-hidden">
        {sites.map((s) => (
          <li key={s.agentId} className="flex items-center justify-between px-5 py-3.5">
            <Link
              to={`/site/${encodeURIComponent(s.agentId)}`}
              className="group flex min-w-0 flex-1 items-center gap-3"
            >
              {/* tiny site icon */}
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-900/90 text-[11px] font-semibold text-white">
                {prettyUrl(s.url).slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900 group-hover:text-ink-700">
                  {prettyUrl(s.url)}
                </p>
                <p className="text-xs text-ink-400">
                  last opened {timeAgo(s.lastVisitedAt)}
                </p>
              </div>
            </Link>
            {/* forget button - removes from list only */}
            <button
              onClick={() => onForget(s.agentId)}
              className="ml-3 rounded-full p-2 text-ink-400 hover:bg-ink-50 hover:text-ink-700"
              aria-label={`Forget ${prettyUrl(s.url)} from this browser`}
              title="Forget from this browser"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path d="M6 2a1 1 0 0 0-1 1v1H2.5a.5.5 0 0 0 0 1H3l.79 11.13A2 2 0 0 0 5.78 18h8.44a2 2 0 0 0 1.99-1.87L17 5h.5a.5.5 0 0 0 0-1H15V3a1 1 0 0 0-1-1H6zm1 2V3h6v1H7zm1 3.5a.5.5 0 0 1 1 0v7a.5.5 0 0 1-1 0v-7zm3 0a.5.5 0 0 1 1 0v7a.5.5 0 0 1-1 0v-7z" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
