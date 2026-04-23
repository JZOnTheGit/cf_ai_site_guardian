// tiny toast notification system
// usage:
//   const { toast, Toaster } = useToast();
//   toast("Scan complete");
//   return (<> ... <Toaster /> </>);
//
// we don't pull in a library because the app only needs success/error toasts

import { useCallback, useEffect, useState } from "react";

// shape of one toast row
interface ToastRow {
  id: number;
  text: string;
  tone: "info" | "success" | "error";
}

// pick the right ring color for each tone
function toneClass(tone: ToastRow["tone"]): string {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200";
  }
  if (tone === "error") {
    return "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200";
  }
  return "border-ink-200 bg-white text-ink-900 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100";
}

// hook that returns a toast function + the <Toaster /> element to render
export function useToast() {
  const [rows, setRows] = useState<ToastRow[]>([]);

  // push a toast, auto-dismiss after a few seconds
  const toast = useCallback(
    (text: string, tone: ToastRow["tone"] = "info", ms = 3500) => {
      const id = Date.now() + Math.random();
      setRows((r) => [...r, { id, text, tone }]);
      // schedule removal so the dom doesn't stack up forever
      setTimeout(() => {
        setRows((r) => r.filter((t) => t.id !== id));
      }, ms);
    },
    [],
  );

  // the actual container rendered at the top right
  const Toaster = useCallback(
    () => (
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-xs flex-col gap-2">
        {rows.map((r) => (
          <div
            key={r.id}
            className={`toast-in pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-card ${toneClass(r.tone)}`}
            role="status"
          >
            {r.text}
          </div>
        ))}
      </div>
    ),
    [rows],
  );

  // return stable references so the parent can put them in deps arrays safely
  return { toast, Toaster };
}

// one-off "copied" inline tick for small buttons
export function useCopyFlash(ms = 1200) {
  const [flashed, setFlashed] = useState(false);
  useEffect(() => {
    if (!flashed) return;
    const t = setTimeout(() => setFlashed(false), ms);
    return () => clearTimeout(t);
  }, [flashed, ms]);
  return [flashed, setFlashed] as const;
}
