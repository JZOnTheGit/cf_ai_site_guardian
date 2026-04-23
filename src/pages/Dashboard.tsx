// dashboard page for one site agent
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type AgentSnapshot } from "../lib/api";
import { forgetSite, rememberSite } from "../lib/storage";
import { useHotkey } from "../lib/shortcuts";
import { ScoreCard } from "../components/ScoreCard";
import { IssueList } from "../components/IssueList";
import { SecurityHeaders } from "../components/SecurityHeaders";
import { Timeline } from "../components/Timeline";
import { ChatPanel } from "../components/ChatPanel";
import { ShareLinkCard } from "../components/ShareLinkCard";
import { AutoScanControl } from "../components/AutoScanControl";
import { ScanDiff } from "../components/ScanDiff";
import { DarkModeToggle } from "../components/DarkModeToggle";
import { DashboardSkeleton } from "../components/SkeletonLoader";
import { useToast } from "../components/Toast";

export default function Dashboard() {
  // agent id comes from the url segment
  const { agentId: rawId = "" } = useParams();
  const agentId = decodeURIComponent(rawId);
  const navigate = useNavigate();

  // page-level state
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // toast notifier shared with children
  const { toast, Toaster } = useToast();

  // ref so cmd+k can focus the chat input
  const chatInputRef = useRef<HTMLInputElement | null>(null);

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
  // runScan is defined below so we intentionally don't list it as a dep
  useEffect(() => {
    if (!loading && snapshot && !snapshot.latest && !scanning) {
      runScan();
    }
  }, [loading, snapshot]);

  // kick off a scan then refresh the page data
  async function runScan() {
    setScanning(true);
    setError(null);
    try {
      await api.scan(agentId);
      await refresh();
      toast("Scan complete", "success");
    } catch (err: any) {
      setError(err?.message ?? "Scan failed");
      toast(err?.message ?? "Scan failed", "error");
    } finally {
      setScanning(false);
    }
  }

  // ask the server to destroy this agent, then go home
  async function deleteAgent() {
    if (
      !confirm(
        "Delete this agent and every byte of its data (scans, chat, settings)? This cannot be undone.",
      )
    ) {
      return;
    }
    try {
      await api.deleteAgent(agentId);
      forgetSite(agentId);
      toast("Agent deleted", "success");
      // small delay so the toast is visible
      setTimeout(() => navigate("/"), 400);
    } catch (err: any) {
      toast(err?.message ?? "Failed to delete", "error");
    }
  }

  // download the audit as a json file
  function exportAudit() {
    // use a real <a download> so the browser handles the save dialog
    const a = document.createElement("a");
    a.href = api.exportUrl(agentId);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("Downloading export...", "info");
  }

  // keyboard shortcuts: cmd+k focus chat, r rescan (only when not typing)
  useHotkey({ key: "k", meta: true }, () => chatInputRef.current?.focus());
  useHotkey({ key: "r" }, () => {
    if (!scanning) runScan();
  });

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

  // for the diff card: fetch the two most recent full scan records
  const [previousScan, setPreviousScan] = useState<typeof latest>(null);
  useEffect(() => {
    // only do this when we already have the latest, otherwise there is no point
    if (!latest || (snapshot?.history.length ?? 0) < 2) {
      setPreviousScan(null);
      return;
    }
    api
      .history(agentId)
      .then((rows) => {
        // rows come back newest-first so [1] is the previous scan
        setPreviousScan(rows[1] ?? null);
      })
      .catch(() => setPreviousScan(null));
  }, [agentId, latest, snapshot?.history.length]);

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
    <div className="min-h-full bg-ink-50 pb-24 dark:bg-ink-900">
      <Toaster />
      {/* sticky-feeling top bar */}
      {/* relative + high z-index so popovers (overflow menu, dark-mode, */}
      {/* auto-scan) always paint above the main content's stacking context */}
      <header className="relative z-30 border-b border-ink-100 bg-white/80 backdrop-blur dark:border-ink-700 dark:bg-ink-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 text-ink-900 dark:text-ink-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white dark:bg-white dark:text-ink-900">
              SG
            </span>
            <span className="font-semibold tracking-tight">Site Guardian</span>
          </Link>
          <div className="flex items-center gap-3">
            {/* status pill */}
            <div className="hidden items-center gap-2 md:flex">
              <span className={`h-2 w-2 rounded-full ${status.color}`} />
              <span className="text-xs text-ink-500 dark:text-ink-400">
                {status.label}
              </span>
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
            {/* overflow menu with destructive + export actions */}
            <OverflowMenu
              onExport={exportAudit}
              onDelete={deleteAgent}
              disabled={loading}
            />
            <DarkModeToggle />
            {/* manual scan trigger */}
            <button
              className="btn-primary"
              onClick={runScan}
              disabled={scanning || loading}
              title="Run new scan (press R)"
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
            <h1 className="text-3xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
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
        {!loading && meta && <ShareLinkCard url={window.location.href} />}

        {/* error banner if something went wrong */}
        {error && (
          <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <DashboardSkeleton />
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* left column: all the scan content */}
            <div className="space-y-6 lg:col-span-2">
              {/* ai summary card */}
              <div className="card card-pad">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">
                    AI overview
                  </h2>
                  {/* short delta headline if we have a compare result */}
                  {latest?.compare && (
                    <span className="pill">{latest.compare.headline}</span>
                  )}
                </div>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-700 dark:text-ink-200">
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
                          <ul className="mt-2 space-y-1 text-sm text-ink-700 dark:text-ink-300">
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
                          <ul className="mt-2 space-y-1 text-sm text-ink-700 dark:text-ink-300">
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

              {/* diff with previous scan, only renders when we have both */}
              {previousScan && latest && (
                <ScanDiff previous={previousScan} current={latest} />
              )}

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

              {/* accessibility + tls snapshot row */}
              {/* only render if the scan record has the new fields, old scans */}
              {/* from before v1.1 don't carry accessibility/tls/links */}
              {latest && latest.raw.accessibility && latest.raw.tls && (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <A11yCard scan={latest.raw} />
                  <TlsCard scan={latest.raw} />
                </div>
              )}

              {/* full security headers table */}
              {latest && latest.raw.security.headers.length > 0 && (
                <SecurityHeaders headers={latest.raw.security.headers} />
              )}

              {/* basic seo snapshot */}
              {latest && (
                <div className="card card-pad">
                  <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">
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
              <ChatPanel
                agentId={agentId}
                onToast={toast}
                inputRef={chatInputRef}
              />
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
      <dd className="text-ink-800 break-all dark:text-ink-200">{v}</dd>
    </div>
  );
}

// format bytes as B / KB / MB for the perf hint line
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// accessibility summary card, renders the small a11y snapshot
// defensive: old scans may not have this field at all
function A11yCard({ scan }: { scan: any }) {
  const a = scan?.accessibility;
  if (!a) return null;
  const issues = Array.isArray(a.issues) ? a.issues : [];
  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">
          Accessibility
        </h3>
        <span className="text-xl font-semibold text-ink-900 dark:text-ink-100">
          {a.score ?? "-"}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-400">
        {a.totalImages ?? 0} image(s), {a.imagesMissingAlt ?? 0} missing alt
      </p>
      {issues.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">No issues detected.</p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-sm text-ink-700 dark:text-ink-200">
          {issues.map((i: any, idx: number) => (
            <li key={i?.id ?? idx}>- {i?.message ?? String(i)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// tls + network snapshot card
// defensive: scan.links may be undefined on old scans
function TlsCard({ scan }: { scan: any }) {
  const t = scan?.tls;
  if (!t) return null;
  const links = scan?.links ?? { sampled: 0, broken: [] };
  const brokenCount = Array.isArray(links.broken) ? links.broken.length : 0;
  return (
    <div className="card card-pad">
      <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">
        Connection
      </h3>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <KV k="TLS" v={t.protocol ?? "-"} />
        <KV k="Cipher" v={t.cipher ?? "-"} />
        <KV k="HTTP" v={t.httpVersion ?? "-"} />
        <KV k="Country" v={t.country ?? "-"} />
        <KV k="Colo" v={t.colo ?? "-"} />
        <KV k="Links broken" v={`${brokenCount} / ${links.sampled ?? 0}`} />
      </dl>
    </div>
  );
}

// tiny kebab-menu with secondary actions
// closes on outside click or escape, not on mouseleave (which was buggy
// because there's a tiny gap between button and menu)
function OverflowMenu({
  onExport,
  onDelete,
  disabled,
}: {
  onExport: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // close when user clicks anywhere outside the menu or hits escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 bg-white transition hover:bg-ink-50 disabled:opacity-50 dark:border-ink-700 dark:bg-ink-800 dark:hover:bg-ink-700"
        aria-label="Open actions menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="text-ink-600 dark:text-ink-200" aria-hidden>
          ⋯
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 z-20 w-52 overflow-hidden rounded-xl border border-ink-200 bg-white text-sm shadow-card dark:border-ink-700 dark:bg-ink-800"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onExport();
            }}
            className="block w-full px-4 py-2.5 text-left text-ink-800 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-700"
          >
            Download JSON export
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="block w-full px-4 py-2.5 text-left text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
          >
            Delete this agent...
          </button>
        </div>
      )}
    </div>
  );
}
