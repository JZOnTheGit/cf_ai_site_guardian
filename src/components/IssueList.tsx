// simple bulleted list used for "issues found" and "recommended fixes"

// props for the list card
interface Props {
  title: string;
  items: string[];
  empty?: string;
  tone?: "neutral" | "fix" | "issue";
}

export function IssueList({ title, items, empty, tone = "neutral" }: Props) {
  // pick dot color based on the list tone
  const dotClass =
    tone === "issue"
      ? "bg-red-500"
      : tone === "fix"
        ? "bg-emerald-500"
        : "bg-ink-400";

  return (
    <div className="card card-pad">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {/* show an empty-state line when there are no items */}
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-ink-400">{empty ?? "Nothing to report."}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {/* render each bullet with a colored dot */}
          {items.map((it, i) => (
            <li key={i} className="flex gap-3 text-sm text-ink-700 leading-relaxed">
              <span
                className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
                aria-hidden
              />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
