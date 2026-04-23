// dark mode manager
// stores the user's choice in localStorage and syncs it with <html class="dark">
// we also respect prefers-color-scheme on first visit

export type ThemeMode = "light" | "dark" | "system";

const KEY = "sg:theme";

// read the current saved preference, defaulting to "system"
export function getThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

// compute the actual mode to apply ("system" -> light or dark)
function resolve(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

// add/remove the .dark class on <html>
function apply(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const effective = resolve(mode);
  const root = document.documentElement;
  if (effective === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

// public setter used by the toggle
export function setThemeMode(mode: ThemeMode) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, mode);
  }
  apply(mode);
}

// called once at app bootstrap (see main.tsx) so the page renders with the
// right theme on first paint and reacts to os-level changes afterwards
export function initTheme() {
  const saved = getThemeMode();
  apply(saved);
  if (typeof window !== "undefined") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    // if the user picked "system", follow os changes live
    mq.addEventListener("change", () => {
      const mode = getThemeMode();
      if (mode === "system") apply("system");
    });
  }
}

// cycle through the three modes for the button click
export function nextThemeMode(m: ThemeMode): ThemeMode {
  if (m === "light") return "dark";
  if (m === "dark") return "system";
  return "light";
}
