// dashboard page for one site agent
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type AgentSnapshot } from "../lib/api";
import { rememberSite } from "../lib/storage";
import { ScoreCard } from "../components/ScoreCard";
import { IssueList } from "../components/IssueList";
import { SecurityHeaders } from "../components/SecurityHeaders";
import { Timeline } from "../components/Timeline";
import { ChatPanel } from "../components/ChatPanel";
import { ShareLinkCard } from "../components/ShareLinkCard";
import { AutoScanControl } from "../components/AutoScanControl";

export default function Dashboard() {
  // agent id comes from the url segment
  const { agentId: rawId = "" } = useParams();
  const agentId = decodeURIComponent(rawId);

  // page-level state
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // fetch the latest snapshot from the DO
  const refresh = useCallback(async () => {
    try {
      const s = await api.snapshot(agentId);
      setSnapshot(s);
      // also bookmark this agent in the browser so the landing page can find it
      if (s.meta?.url) {
        rememberSite({ agentId, url: s.meta.url });
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to load agent");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // auto-kick a first scan if the agent has no history yet
  useEffect(() => {
    if (!loading && snapshot && !snapshot.latest && !scanning) {
      runScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, snapshot]);

  // kick off a scan then refresh the page data
  async function runScan() {
    setScanning(true);
    setError(null);
    try {
      await api.scan(agentId);
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  // shortcuts pulled out of the snapshot
  const latest = snapshot?.latest ?? null;
  const meta = snapshot?.meta ?? null;

  // per-score history arrays in chronological order, fed into sparklines
  // snapshot.history comes back newest-first so we reverse it
  const perfHistory = useMemo(
    () =>
      (snapshot?.history ?? [])
        .slice()
        .reverse()
        .map((h) => h.scores.performance),
    [snapshot],
  );
  const secHistory = useMemo(
    () =>
      (snapshot?.history ?? [])
        .slice()
        .reverse()
        .map((h) => h.scores.security),
    [snapshot],
  );
  const seoHistory = useMemo(
    () =>
      (snapshot?.history ?? [])
        .slice()
        .reverse()
        .map((h) => h.scores.seo),
    [snapshot],
  );

  // overall status pill label + dot color, based on average score
  const status = useMemo(() => {
    if (!latest) return { label: "Awaiting first scan", color: "bg-ink-300" };
    if (!latest.raw.ok) return { label: "Unreachable", color: "bg-red-500" };
    const avg = Math.round(
      (latest.insight.scores.performance +
        latest.insight.scores.security +
        latest.insight.scores.seo) /
        3,
    );
    if (avg >= 85) return { label: "Healthy", color: "bg-emerald-500" };
    if (avg >= 60) return { label: "Needs attention", color: "bg-amber-500" };
    return { label: "Critical", color: "bg-red-500" };
  }, [latest]);

  return (
    <div className="min-h-full bg-ink-50 pb-24">
      {/* sticky-feeling top bar */}
      <header className="border-b border-ink-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 text-ink-900">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">
              SG
            </span>
            <span className="font-semibold tracking-tight">Site Guardian</span>
          </Link>
          <div className="flex items-center gap-3">
            {/* status pill */}
            <div className="hidden items-center gap-2 md:flex">
              <span className={`h-2 w-2 rounded-full ${status.color}`} />
              <span className="text-xs text-ink-500">{status.label}</span>
            </div>
            {/* auto-scan schedule control, persists in the durable object */}
            {snapshot?.settings && (
              <AutoScanControl
                agentId={agentId}
                settings={snapshot.settings}
                onChange={(next) =>
                  setSnapshot((s) => (s ? { ...s, settings: next } : s))
                }
              />
            )}
            {/* manual scan trigger */}
            <button
              className="btn-primary"
              onClick={runScan}
              disabled={scanning || loading}
            >
              {scanning ? "Scanning..." : "Run new scan"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pt-10 fade-in">
        {/* title bar with site url and last scan time */}
        <section className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-ink-400">
            Monitored site
          </p>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
              {meta?.url ?? (loading ? "Loading..." : "Unknown")}
            </h1>
            {latest && (
              <span className="text-sm text-ink-400">
                last scan {new Date(latest.at).toLocaleString()}
              </span>
            )}
          </div>
        </section>

        {/* tells the user this url is a permanent bookmark to this agent */}
        {!loading && meta && (
          <ShareLinkCard url={window.location.href} />
        )}

        {/* error banner if something went wrong */}
        {error && (
          <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          // skeleton while the first snapshot is loading
          <SkeletonGrid />
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* left column: all the scan content */}
            <div className="space-y-6 lg:col-span-2">
              {/* ai summary card */}
              <div className="card card-pad">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-ink-900">
                    AI overview
                  </h2>
                  {/* short delta headline if we have a compare result */}
                  {latest?.compare && (
                    <span className="pill">{latest.compare.headline}</span>
                  )}
                </div>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-700">
                  {latest
                    ? latest.insight.summary
                    : scanning
                      ? "Running your first scan..."
                      : "No scan yet."}
                </p>

                {/* regressions + improvements from the compare call */}
                {latest?.compare &&
                  (latest.compare.regressions.length > 0 ||
                    latest.compare.improvements.length > 0) && (
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      {latest.compare.regressions.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-red-600">
                            Regressions
                          </p>
                          <ul className="mt-2 space-y-1 text-sm text-ink-700">
                            {latest.compare.regressions.map((r, i) => (
                              <li key={i}>- {r}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {latest.compare.improvements.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
                            Improvements
                          </p>
                          <ul className="mt-2 space-y-1 text-sm text-ink-700">
                            {latest.compare.improvements.map((r, i) => (
                              <li key={i}>- {r}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
              </div>

              {/* three score cards side by side, each with a sparkline trend */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <ScoreCard
                  label="Performance"
                  score={latest?.insight.scores.performance ?? 0}
                  history={perfHistory}
                  hint={
                    latest
                      ? `TTFB ${latest.raw.performance.ttfbMs} ms · ${formatBytes(
                          latest.raw.performance.htmlBytes,
                        )} HTML`
                      : undefined
                  }
                />
                <ScoreCard
                  label="Security"
                  score={latest?.insight.scores.security ?? 0}
                  history={secHistory}
                  hint={
                    latest
                      ? `${latest.raw.security.missingCount} missing headers`
                      : undefined
                  }
                />
                <ScoreCard
                  label="SEO"
                  score={latest?.insight.scores.seo ?? 0}
                  history={seoHistory}
                  hint={
                    latest
                      ? `${latest.raw.seo.h1Count} h1 · ${
                          latest.raw.seo.metaDescription ? "has" : "no"
                        } meta`
                      : undefined
                  }
                />
              </div>

              {/* issues found + recommended fixes */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <IssueList
                  title="Issues found"
                  items={latest?.insight.issues ?? []}
                  empty="No issues detected."
                  tone="issue"
                />
                <IssueList
                  title="Recommended fixes"
                  items={latest?.insight.fixes ?? []}
                  empty="Nothing to do right now."
                  tone="fix"
                />
              </div>

              {/* full security headers table */}
              {latest && latest.raw.security.headers.length > 0 && (
                <SecurityHeaders headers={latest.raw.security.headers} />
              )}

              {/* basic seo snapshot */}
              {latest && (
                <div className="card card-pad">
                  <h3 className="text-sm font-semibold text-ink-900">
                    SEO snapshot
                  </h3>
                  <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <KV k="Title" v={latest.raw.seo.title ?? "-"} />
                    <KV
                      k="Meta description"
                      v={latest.raw.seo.metaDescription ?? "-"}
                    />
                    <KV k="H1 count" v={String(latest.raw.seo.h1Count)} />
                    <KV k="Viewport" v={latest.raw.seo.hasViewport ? "yes" : "no"} />
                    <KV
                      k="Canonical"
                      v={latest.raw.seo.hasCanonical ? "yes" : "no"}
                    />
                    <KV k="Lang" v={latest.raw.seo.lang ?? "-"} />
                  </dl>
                </div>
              )}

              {/* scan history */}
              <Timeline history={snapshot?.history ?? []} />
            </div>

            {/* right column: sticky chat panel */}
            <div className="lg:sticky lg:top-6 lg:self-start">
              <ChatPanel agentId={agentId} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// tiny key-value row used in the seo snapshot card
function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-36 shrink-0 text-ink-400">{k}</dt>
      <dd className="text-ink-800 break-all">{v}</dd>
    </div>
  );
}

// loading skeleton shown before the first snapshot arrives
function SkeletonGrid() {
  return (
    <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="card h-32 animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          <div className="card h-28 animate-pulse" />
          <div className="card h-28 animate-pulse" />
          <div className="card h-28 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div className="card h-48 animate-pulse" />
          <div className="card h-48 animate-pulse" />
        </div>
      </div>
      <div className="card h-[560px] animate-pulse" />
    </div>
  );
}

// format bytes as B / KB / MB for the perf hint line
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
