// table-ish list showing which security headers are present on the site
// missing headers get a "copy fix snippet" button so devs can grab a fix instantly
import { useState } from "react";
import type { SecurityHeaderCheck } from "../lib/api";
import { CopyCodeSnippet, suggestedHeaderSnippet } from "./CopyCodeSnippet";

// props for the table
interface Props {
  headers: SecurityHeaderCheck[];
}

// color theme for the little severity pill, reuses shared sev-* classes
function severityChipClass(s: SecurityHeaderCheck["severity"]) {
  if (s === "high") return "sev-high";
  if (s === "medium") return "sev-medium";
  return "sev-low";
}

export function SecurityHeaders({ headers }: Props) {
  // track which row is currently expanded showing the copy-snippet block
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="card">
      {/* card header */}
      <div className="border-b border-ink-100 px-6 py-4 dark:border-ink-700">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">
          Security headers
        </h3>
        <p className="text-xs text-ink-400">Checked on the most recent scan</p>
      </div>
      {/* one row per header */}
      <ul className="divide-y divide-ink-100 dark:divide-ink-700">
        {headers.map((h) => {
          const isOpen = expanded === h.header;
          return (
            <li key={h.header} className="px-6 py-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                {/* left side: status dot, header name, severity chip */}
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      h.present ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  />
                  <code className="text-sm text-ink-900 dark:text-ink-100">
                    {h.header}
                  </code>
                  <span
                    className={`hidden rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide sm:inline ${severityChipClass(
                      h.severity,
                    )}`}
                  >
                    {h.severity}
                  </span>
                </div>
                {/* right side: actual value or "missing" + copy-fix toggle */}
                <div className="flex items-center gap-3 text-xs text-ink-500">
                  {h.present ? (
                    <span className="truncate max-w-[28ch] sm:max-w-[48ch] inline-block align-middle">
                      {h.value}
                    </span>
                  ) : (
                    <>
                      <span className="text-red-600">missing</span>
                      <button
                        onClick={() => setExpanded(isOpen ? null : h.header)}
                        className="rounded-full border border-ink-200 bg-white px-2 py-0.5 text-[11px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
                      >
                        {isOpen ? "Hide fix" : "Copy fix"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* expanded snippet block for this header */}
              {isOpen && !h.present && (
                <CopyCodeSnippet code={suggestedHeaderSnippet(h.header)} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
