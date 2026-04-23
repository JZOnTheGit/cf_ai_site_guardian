// copy-as-code button with a tiny code preview
// renders a selectable <pre> and a button that copies it to the clipboard
// used next to each missing security header as a quick fix

import { useCopyFlash } from "./Toast";

// what the caller passes us
interface Props {
  code: string;
  // short label to show inside the button
  label?: string;
}

export function CopyCodeSnippet({ code, label = "Copy snippet" }: Props) {
  const [copied, setCopied] = useCopyFlash();

  // copy the snippet to the system clipboard + flash the button
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // clipboard can fail in insecure contexts, nothing we can do
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <pre className="overflow-x-auto rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-800 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100">
        {code}
      </pre>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[11px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
      >
        {copied ? "Copied!" : label}
      </button>
    </div>
  );
}

// build a suggested header snippet for a given header name
// these are safe, sensible defaults; users can tune for their app
export function suggestedHeaderSnippet(header: string): string {
  switch (header) {
    case "content-security-policy":
      return `# Cloudflare Workers
response.headers.set(
  "Content-Security-Policy",
  "default-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self' 'unsafe-inline'"
);`;
    case "strict-transport-security":
      return `# Cloudflare Workers
response.headers.set(
  "Strict-Transport-Security",
  "max-age=31536000; includeSubDomains; preload"
);`;
    case "x-frame-options":
      return `response.headers.set("X-Frame-Options", "DENY");`;
    case "x-content-type-options":
      return `response.headers.set("X-Content-Type-Options", "nosniff");`;
    case "referrer-policy":
      return `response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");`;
    case "permissions-policy":
      return `response.headers.set(
  "Permissions-Policy",
  "camera=(), microphone=(), geolocation=(), interest-cohort=()"
);`;
    default:
      return `response.headers.set("${header}", "...");`;
  }
}
