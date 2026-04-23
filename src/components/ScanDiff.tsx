// side-by-side diff view comparing the two most recent scans
// shows score deltas + missing/added headers so you can see progress at a glance

import type { ScanRecord } from "../lib/api";

// what the dashboard passes in
interface Props {
  previous: ScanRecord | null;
  current: ScanRecord | null;
}

// helper that returns a signed delta string + the tone color
function delta(prev: number, curr: number): { text: string; tone: string } {
  const d = curr - prev;
  if (d === 0) return { text: "no change", tone: "text-ink-400" };
  const sign = d > 0 ? "+" : "";
  const tone = d > 0 ? "text-emerald-600" : "text-red-600";
  return { text: `${sign}${d}`, tone };
}

export function ScanDiff({ previous, current }: Props) {
  // nothing to show if we don't have both scans
  if (!previous || !current) return null;

  const p = previous.raw;
  const c = current.raw;

  // compute missing header diffs
  const prevMissing = new Set(
    p.security.headers.filter((h) => !h.present).map((h) => h.header),
  );
  const currMissing = new Set(
    c.security.headers.filter((h) => !h.present).map((h) => h.header),
  );
  const newlyMissing = [...currMissing].filter((h) => !prevMissing.has(h));
  const newlyFixed = [...prevMissing].filter((h) => !currMissing.has(h));

  // perf + score deltas
  const rows = [
    {
      label: "Performance",
      prev: previous.insight.scores.performance,
      curr: current.insight.scores.performance,
    },
    {
      label: "Security",
      prev: previous.insight.scores.security,
      curr: current.insight.scores.security,
    },
    {
      label: "SEO",
      prev: previous.insight.scores.seo,
      curr: current.insight.scores.seo,
    },
    {
      label: "TTFB (ms)",
      prev: p.performance.ttfbMs,
      curr: c.performance.ttfbMs,
      // for ttfb lower is better, flip the sign when we compute the tone
      invert: true,
    },
  ] as const;

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">
          Diff with previous scan
        </h3>
        <p className="text-xs text-ink-400">
          {new Date(previous.at).toLocaleDateString()} -&gt;{" "}
          {new Date(current.at).toLocaleDateString()}
        </p>
      </div>

      {/* numeric diff table */}
      <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {rows.map((r) => {
          const d = delta(r.prev, r.curr);
          // flip color meaning if lower is better (like ttfb)
          const tone = (r as any).invert
            ? r.curr < r.prev
              ? "text-emerald-600"
              : r.curr > r.prev
                ? "text-red-600"
                : "text-ink-400"
            : d.tone;
          return (
            <div
              key={r.label}
              className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 dark:bg-ink-700"
            >
              <dt className="text-ink-600 dark:text-ink-300">{r.label}</dt>
              <dd className="flex items-center gap-2 font-medium text-ink-900 dark:text-ink-100">
                <span className="text-ink-400">{r.prev}</span>
                <span className="text-ink-400">→</span>
                <span>{r.curr}</span>
                <span className={tone}>{d.text}</span>
              </dd>
            </div>
          );
        })}
      </dl>

      {/* header diff lists */}
      {(newlyMissing.length > 0 || newlyFixed.length > 0) && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {newlyFixed.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
                Fixed headers
              </p>
              <ul className="mt-2 space-y-1 text-sm text-ink-700 dark:text-ink-300">
                {newlyFixed.map((h) => (
                  <li key={h}>+ {h}</li>
                ))}
              </ul>
            </div>
          )}
          {newlyMissing.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-red-600">
                Newly missing headers
              </p>
              <ul className="mt-2 space-y-1 text-sm text-ink-700 dark:text-ink-300">
                {newlyMissing.map((h) => (
                  <li key={h}>- {h}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
