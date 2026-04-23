// single score card used three times on the dashboard

// props for the score card
interface ScoreCardProps {
  label: string;
  score: number;
  hint?: string;
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

export function ScoreCard({ label, score, hint }: ScoreCardProps) {
  // keep score in 0..100 just in case
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className="card card-pad">
      {/* label on the left, big number on the right */}
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink-500">{label}</span>
        <span className={`text-3xl font-semibold tracking-tight ${scoreColor(clamped)}`}>
          {clamped}
        </span>
      </div>
      {/* progress bar animates when the score changes */}
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className={`h-full rounded-full transition-all duration-500 ${scoreBg(clamped)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {/* optional small hint under the bar */}
      {hint && <p className="mt-3 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
