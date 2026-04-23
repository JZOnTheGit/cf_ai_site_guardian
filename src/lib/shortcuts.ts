// tiny keyboard-shortcut hook used on the dashboard + chat panel
// registers a global listener and fires the handler when the combo matches

import { useEffect } from "react";

// a hotkey spec, like { key: "k", meta: true } for cmd+k
// meta matches cmd on mac and ctrl on other platforms
export interface HotkeySpec {
  key: string;
  meta?: boolean;
  shift?: boolean;
}

// true if the event matches the spec we expect
function matches(e: KeyboardEvent, spec: HotkeySpec): boolean {
  const metaOrCtrl = e.metaKey || e.ctrlKey;
  if (spec.meta && !metaOrCtrl) return false;
  if (!spec.meta && metaOrCtrl) return false;
  if (spec.shift && !e.shiftKey) return false;
  return e.key.toLowerCase() === spec.key.toLowerCase();
}

// register a hotkey for the lifetime of the component
export function useHotkey(spec: HotkeySpec, handler: (e: KeyboardEvent) => void) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      // do not fire while the user is typing inside a form field,
      // unless the shortcut explicitly uses cmd/ctrl
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing && !spec.meta) return;
      if (matches(e, spec)) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [spec.key, spec.meta, spec.shift, handler]);
}
