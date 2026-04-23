// scan history timeline shown on the dashboard
import type { AgentSnapshot } from "../lib/api";

// props are just the list of history rows from /api/snapshot
interface Props {
  history: AgentSnapshot["history"];
}

// turn a timestamp into a short "5m ago" / "2d ago" string
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

// dot color based on the average score for that scan
function dot(score: number): string {
  if (score >= 85) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-red-500";
}

export function Timeline({ history }: Props) {
  // empty state when no scans exist yet
  if (history.length === 0) {
    return (
      <div className="card card-pad text-sm text-ink-500">
        No scans yet. Run your first scan to see history here.
      </div>
    );
  }

  return (
    <div className="card">
      {/* header */}
      <div className="border-b border-ink-100 px-6 py-4">
        <h3 className="text-sm font-semibold text-ink-900">Scan history</h3>
        <p className="text-xs text-ink-400">Latest {history.length} scans</p>
      </div>
      {/* list of scans, newest first */}
      <ol className="divide-y divide-ink-100">
        {history.map((h) => {
          // average score to pick the dot color
          const avg = Math.round(
            (h.scores.performance + h.scores.security + h.scores.seo) / 3,
          );
          return (
            <li
              key={h.id}
              className="flex items-center justify-between px-6 py-3 text-sm"
            >
              {/* left side: status dot, time, http status chip */}
              <div className="flex items-center gap-3">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${dot(avg)}`}
                  aria-hidden
                />
                <span className="text-ink-700">{timeAgo(h.at)}</span>
                <span className="pill">HTTP {h.status || "-"}</span>
              </div>
              {/* right side: the three scores in short form */}
              <div className="flex items-center gap-4 text-xs text-ink-500">
                <span>
                  Perf <b className="text-ink-900">{h.scores.performance}</b>
                </span>
                <span>
                  Sec <b className="text-ink-900">{h.scores.security}</b>
                </span>
                <span>
                  SEO <b className="text-ink-900">{h.scores.seo}</b>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
