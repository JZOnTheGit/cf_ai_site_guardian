// bulleted list used for "issues found" and "recommended fixes"
// issues carry a severity tag so the ui can color code them
import type { InsightIssue, Severity } from "../lib/api";

// accept either rich issue objects or plain strings (fixes list is plain)
type Item = InsightIssue | string;

// props for the list card
interface Props {
  title: string;
  items: Item[];
  empty?: string;
  tone?: "neutral" | "fix" | "issue";
}

// map severity -> colored dot class
function dotForSeverity(s: Severity) {
  if (s === "critical") return "bg-red-600";
  if (s === "high") return "bg-red-500";
  if (s === "medium") return "bg-amber-500";
  return "bg-ink-400";
}

// severity chip class (uses utility classes defined in src/index.css)
function chipForSeverity(s: Severity) {
  if (s === "critical") return "sev-critical";
  if (s === "high") return "sev-high";
  if (s === "medium") return "sev-medium";
  return "sev-low";
}

export function IssueList({ title, items, empty, tone = "neutral" }: Props) {
  // default dot color for the non-issue list (fixes)
  const defaultDot =
    tone === "issue"
      ? "bg-red-500"
      : tone === "fix"
        ? "bg-emerald-500"
        : "bg-ink-400";

  return (
    <div className="card card-pad">
      <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">{title}</h3>
      {/* show an empty-state line when there are no items */}
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-ink-400">
          {empty ?? "Nothing to report."}
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {items.map((it, i) => {
            // figure out if this row carries a severity (issues do, fixes do not)
            const isIssueObject = typeof it !== "string";
            const severity = isIssueObject ? it.severity : null;
            const text = isIssueObject ? it.text : it;
            const dotClass = severity ? dotForSeverity(severity) : defaultDot;

            return (
              <li
                key={i}
                className="flex gap-3 text-sm text-ink-700 leading-relaxed dark:text-ink-200"
              >
                <span
                  className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
                  aria-hidden
                />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span>{text}</span>
                  {/* small colored severity pill for issues */}
                  {severity && (
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${chipForSeverity(severity)}`}
                    >
                      {severity}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
