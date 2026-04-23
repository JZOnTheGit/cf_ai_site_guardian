// small banner shown at the top of the dashboard
// explains that the current url is a permanent bookmark for this agent
import { useState } from "react";

// props are just the dashboard url to copy
interface Props {
  url: string;
}

export function ShareLinkCard({ url }: Props) {
  // shows "Copied" for a second after the click
  const [copied, setCopied] = useState(false);

  // copy to clipboard with a tiny toast
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard may be blocked, just no-op
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-ink-100 bg-white px-5 py-4 shadow-soft sm:flex-row sm:items-center sm:gap-4">
      {/* link icon */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-900/90 text-white">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M10 13.5a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11.5 6.34M14 10.5a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 1 0 5.66 5.66L12.5 17.66"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* copy explaining what the url is for */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900">
          Bookmark this link to come back anytime
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-500">
          Your scan history and chat live on Cloudflare. Save this URL (or use
          "Your monitored sites" on the home page) to reopen this agent later.
        </p>
      </div>

      {/* url + copy button */}
      <div className="flex items-center gap-2 sm:ml-auto">
        <code className="hidden max-w-[20ch] truncate rounded-full border border-ink-200 bg-ink-50 px-3 py-1.5 text-xs text-ink-700 sm:inline md:max-w-[32ch]">
          {url}
        </code>
        <button
          onClick={copy}
          className="btn-ghost whitespace-nowrap"
          aria-label="Copy link to this agent"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
