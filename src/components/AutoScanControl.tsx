// small dropdown in the dashboard header that turns on scheduled scans
// backed by a durable object alarm, runs even when the browser is closed
import { useState } from "react";
import { api, type AgentSettings } from "../lib/api";

// props: current settings + callback to refresh the dashboard after a save
interface Props {
  agentId: string;
  settings: AgentSettings;
  onChange: (next: AgentSettings) => void;
}

// preset intervals to keep the ui simple
const OPTIONS: Array<{ hours: number | null; label: string }> = [
  { hours: null, label: "Off" },
  { hours: 1, label: "Every 1h" },
  { hours: 6, label: "Every 6h" },
  { hours: 24, label: "Every 24h" },
];

// tiny helper to format the next scan timestamp
function nextScanLabel(ts: number | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  return `next at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function AutoScanControl({ agentId, settings, onChange }: Props) {
  const [saving, setSaving] = useState(false);
  const active = settings.autoScanIntervalHours !== null;

  // persist the new interval to the durable object
  async function setInterval(hours: number | null) {
    setSaving(true);
    try {
      const next = await api.updateSettings(agentId, hours);
      onChange(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* status dot + label */}
      <span
        className={`h-2 w-2 rounded-full ${active ? "bg-emerald-500" : "bg-ink-300"}`}
      />
      <span className="hidden text-xs text-ink-500 sm:inline dark:text-ink-400">
        {active
          ? nextScanLabel(settings.nextScanAt) ?? "auto-scan on"
          : "auto-scan off"}
      </span>

      {/* interval selector */}
      <label className="relative">
        <span className="sr-only">Auto-scan interval</span>
        <select
          className="appearance-none rounded-full border border-ink-200 bg-white px-3 py-1.5 pr-8 text-xs text-ink-800 shadow-soft focus:outline-none focus:ring-2 focus:ring-ink-900/10 disabled:opacity-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"
          value={String(settings.autoScanIntervalHours ?? "off")}
          disabled={saving}
          onChange={(e) => {
            const v = e.target.value;
            setInterval(v === "off" ? null : Number(v));
          }}
        >
          {OPTIONS.map((o) => (
            <option key={o.label} value={o.hours === null ? "off" : String(o.hours)}>
              {o.label}
            </option>
          ))}
        </select>
        {/* chevron icon on the dropdown */}
        <svg
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-400"
          width="10"
          height="10"
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden
        >
          <path
            d="M1 1l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </label>
    </div>
  );
}
