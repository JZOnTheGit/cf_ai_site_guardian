// single score card used three times on the dashboard
// now shows a sparkline trend and a delta arrow vs the previous scan
import { Sparkline } from "./Sparkline";

// props for the score card
interface ScoreCardProps {
  label: string;
  score: number;
  hint?: string;
  // score history in chronological order (oldest first) for the sparkline
  history?: number[];
}

// pick text color based on score bucket
function scoreColor(score: number) {
  if (score >= 85) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

// pick bar fill color based on score bucket
function scoreBg(score: number) {
  if (score >= 85) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-red-500";
}

// stroke color for the sparkline, matches the bucket
function strokeHex(score: number) {
  if (score >= 85) return "#059669";
  if (score >= 60) return "#d97706";
  return "#dc2626";
}

export function ScoreCard({ label, score, hint, history = [] }: ScoreCardProps) {
  // keep score in 0..100 just in case
  const clamped = Math.max(0, Math.min(100, score));

  // delta vs the previous scan, positive means improved
  const delta =
    history.length >= 2 ? history[history.length - 1] - history[history.length - 2] : 0;

  return (
    <div className="card card-pad">
      {/* label on the left, big number on the right */}
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink-500 dark:text-ink-300">{label}</span>
        <div className="flex items-baseline gap-2">
          {/* delta arrow chip, only shown when we actually have two scans */}
          {history.length >= 2 && delta !== 0 && (
            <span
              className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                delta > 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
              }`}
              aria-label={`${delta > 0 ? "up" : "down"} ${Math.abs(delta)} since last scan`}
            >
              {delta > 0 ? "\u2191" : "\u2193"} {Math.abs(delta)}
            </span>
          )}
          <span className={`text-3xl font-semibold tracking-tight ${scoreColor(clamped)}`}>
            {clamped}
          </span>
        </div>
      </div>

      {/* progress bar animates when the score changes */}
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-700">
        <div
          className={`h-full rounded-full transition-all duration-500 ${scoreBg(clamped)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>

      {/* sparkline + hint row */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-ink-400 truncate dark:text-ink-500">{hint ?? ""}</p>
        {history.length >= 2 && (
          <Sparkline values={history} color={strokeHex(clamped)} width={110} height={24} />
        )}
      </div>
    </div>
  );
}
