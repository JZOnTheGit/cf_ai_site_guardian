// table-ish list showing which security headers are present on the site
import type { SecurityHeaderCheck } from "../lib/api";

// props for the table
interface Props {
  headers: SecurityHeaderCheck[];
}

// color theme for the little severity pill
function severityColor(s: SecurityHeaderCheck["severity"]) {
  if (s === "high") return "text-red-600 bg-red-50 border-red-100";
  if (s === "medium") return "text-amber-700 bg-amber-50 border-amber-100";
  return "text-ink-600 bg-ink-50 border-ink-100";
}

export function SecurityHeaders({ headers }: Props) {
  return (
    <div className="card">
      {/* card header */}
      <div className="border-b border-ink-100 px-6 py-4">
        <h3 className="text-sm font-semibold text-ink-900">Security headers</h3>
        <p className="text-xs text-ink-400">Checked on the most recent scan</p>
      </div>
      {/* one row per header */}
      <ul className="divide-y divide-ink-100">
        {headers.map((h) => (
          <li
            key={h.header}
            className="flex flex-col gap-1 px-6 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            {/* left side: status dot, header name, severity chip */}
            <div className="flex items-center gap-3">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  h.present ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              <code className="text-sm text-ink-900">{h.header}</code>
              <span
                className={`hidden rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide sm:inline ${severityColor(
                  h.severity,
                )}`}
              >
                {h.severity}
              </span>
            </div>
            {/* right side: actual value or "missing" */}
            <div className="text-xs text-ink-500">
              {h.present ? (
                <span className="truncate max-w-[28ch] sm:max-w-[48ch] inline-block align-middle">
                  {h.value}
                </span>
              ) : (
                <span className="text-red-600">missing</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
