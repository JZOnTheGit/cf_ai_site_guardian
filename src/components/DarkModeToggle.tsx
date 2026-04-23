// small three-way toggle that cycles light -> dark -> system
// uses the theme helpers in src/lib/theme.ts

import { useEffect, useState } from "react";
import { getThemeMode, nextThemeMode, setThemeMode, type ThemeMode } from "../lib/theme";

// pick the icon glyph for the current mode
function icon(mode: ThemeMode) {
  if (mode === "light") return "☀️";
  if (mode === "dark") return "🌙";
  return "🖥️";
}

// pretty label for the aria title
function label(mode: ThemeMode) {
  if (mode === "light") return "Light";
  if (mode === "dark") return "Dark";
  return "System";
}

export function DarkModeToggle() {
  // lazy init so we read the correct mode once on mount
  const [mode, setMode] = useState<ThemeMode>("system");
  useEffect(() => {
    setMode(getThemeMode());
  }, []);

  // button click: advance to the next mode and apply it
  function click() {
    const next = nextThemeMode(mode);
    setMode(next);
    setThemeMode(next);
  }

  return (
    <button
      type="button"
      onClick={click}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 bg-white text-sm transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:hover:bg-ink-700"
      title={`Theme: ${label(mode)} (click to change)`}
      aria-label={`Change theme, current: ${label(mode)}`}
    >
      <span aria-hidden>{icon(mode)}</span>
    </button>
  );
}
