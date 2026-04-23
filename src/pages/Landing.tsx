// landing page with the hero + url input
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { findRecentByUrl, rememberSite } from "../lib/storage";
import { RecentSites } from "../components/RecentSites";
import { DarkModeToggle } from "../components/DarkModeToggle";

export default function Landing() {
  // local form state
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // submit the url to the worker, then go to the new agent dashboard
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input = url.trim();
    if (!input) return;
    setLoading(true);
    try {
      // if this device already has an agent for this url, jump straight back
      // into it. agent ids are random per creation now, so without this we'd
      // spawn a new empty agent every time someone re-pastes the same url.
      const existing = findRecentByUrl(input);
      if (existing) {
        rememberSite({ agentId: existing.agentId, url: existing.url });
        navigate(`/site/${encodeURIComponent(existing.agentId)}`);
        return;
      }
      const { agentId, url: savedUrl } = await api.createAgent(input);
      // remember this site in the browser so it shows up in recent sites
      rememberSite({ agentId, url: savedUrl });
      navigate(`/site/${encodeURIComponent(agentId)}`);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-white via-ink-50 to-ink-50 dark:from-ink-900 dark:via-ink-900 dark:to-ink-900">
      {/* top bar with the product name + theme toggle */}
      <header className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-ink-900 dark:text-ink-100">
            <ShieldGlyph />
            <span className="font-semibold tracking-tight">Site Guardian</span>
          </div>
          <DarkModeToggle />
        </div>
      </header>

      {/* hero section */}
      <main className="mx-auto flex max-w-3xl flex-col items-center px-4 pt-14 pb-16 text-center fade-in sm:px-6 sm:pt-24 sm:pb-24">
        <span className="pill mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Live on Cloudflare Workers AI
        </span>

        <h1 className="text-4xl font-semibold tracking-tight text-ink-900 leading-[1.05] sm:text-5xl md:text-6xl dark:text-ink-100">
          Monitor and improve your website
          <br />
          <span className="text-ink-500 dark:text-ink-400">with an AI agent.</span>
        </h1>

        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-500 sm:mt-6 sm:text-lg dark:text-ink-400">
          Site Guardian scans your site for performance, security, and SEO
          issues, remembers what it finds, and tells you exactly what to fix.
        </p>

        {/* the actual input form */}
        <form
          onSubmit={onSubmit}
          className="mt-10 flex w-full max-w-xl flex-col gap-3 sm:flex-row"
        >
          <input
            className="input sm:flex-1"
            placeholder="example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
            aria-label="Website URL"
          />
          <button className="btn-primary sm:px-7" disabled={loading}>
            {loading ? "Starting..." : "Start Monitoring"}
          </button>
        </form>

        {/* error message if the api call fails */}
        {error && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {/* small row of feature cards */}
        <div className="mt-14 grid w-full max-w-4xl gap-4 sm:mt-20 sm:grid-cols-3">
          <Feature
            title="Performance"
            body="Measure TTFB, response size, and asset load, with AI explaining every regression."
          />
          <Feature
            title="Security"
            body="Continuous checks for missing CSP, HSTS, X-Frame-Options, and more."
          />
          <Feature
            title="SEO basics"
            body="Titles, meta descriptions, headings, canonical tags, watched over time."
          />
        </div>

        {/* list of sites this browser has opened before */}
        <RecentSites />
      </main>

      {/* footer credit */}
      <footer className="mx-auto max-w-6xl px-6 pb-10 text-center text-xs text-ink-400">
        Built with Cloudflare Workers, Durable Objects, and Workers AI.
      </footer>
    </div>
  );
}

// little card used in the feature row
function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="card card-pad text-left transition-transform duration-300 hover:-translate-y-0.5">
      <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">{title}</h3>
      <p className="mt-2 text-sm text-ink-500 leading-relaxed dark:text-ink-400">{body}</p>
    </div>
  );
}

// inline shield svg used as the logo
function ShieldGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.75 4.5 5.5v6.1c0 4.65 3.2 8.9 7.5 10.15 4.3-1.25 7.5-5.5 7.5-10.15V5.5L12 2.75Z"
        className="fill-ink-900 dark:fill-white"
      />
      <path
        d="m9 12.2 2.2 2.2L15.5 10"
        className="stroke-white dark:stroke-ink-900"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
