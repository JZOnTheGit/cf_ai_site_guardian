# Changelog

All notable changes to Site Guardian are tracked in this file.

## [1.1.0] - Tier 2: deep upgrade

### Added - AI

- Tool-using chat agent. The model can now call internal tools
  (`get_latest_scan`, `list_history`, `compare_scans`, `request_new_scan`)
  before the streaming reply. The UI shows a "tool: name" pill on the
  assistant bubble when a tool was used.
- Self-critique pass. Every scan insight is fact-checked by a second LLM
  pass against the raw scan data to strip unsupported claims.
- Severity per issue. Issues are now typed objects
  (`{ text, severity: "critical"|"high"|"medium"|"low" }`) and rendered with
  colored chips in the UI.
- Structured JSON mode. Workers AI calls that expect JSON use
  `response_format: { type: "json_object" }` where available, with parsing
  fallbacks if the model returns text.
- Lightweight AI telemetry. Every AI call logs duration and token usage as
  structured JSON to Workers logs, which is easy to filter in the dashboard.

### Added - Scanner

- Accessibility audit (`runA11y`). Heuristic check for missing `alt` text,
  heading order, and `<html lang>` with a 0-100 a11y score.
- TLS and network inspection. Uses `request.cf` to surface the TLS protocol,
  cipher, HTTP version, colo, and country for each scan.
- Broken link detection. Samples up to 8 same-origin links and records any
  that return non-OK responses.
- SSRF protection. An allow/deny list blocks loopback, RFC1918, link-local,
  and cloud-metadata hosts so the scanner cannot be pointed at internal
  resources.
- Fetch caps. Every outbound fetch has a hard timeout and a max-body cap so
  a hostile site cannot exhaust the Worker.

### Added - Platform

- Cron trigger. `wrangler.toml` declares an hourly `scheduled` handler as a
  safety net for Durable Object alarms.
- Asset caching + preload hints. Hashed Vite assets are served with
  `cache-control: immutable, max-age=31536000`, and HTML gets a
  `Link: rel=preload` hint for the main bundle.
### Added - Security

- `worker/security.ts` centralizing `ssrfReason`, `isValidAgentId`,
  `isSameOrigin` (CSRF check), `assertString`, `assertOptionalNumber`,
  `HttpError`, and an in-memory sliding-window `rateLimit`.
- Rate limits on mutating endpoints (create-agent, scan, chat, clear-chat,
  delete-agent) keyed by `cf-connecting-ip`.
- Durable Object storage caps (`MAX_MESSAGES`, `MAX_SCANS`) so long-lived
  agents cannot grow unbounded.
- Agent-id hex validation and same-origin POST checks at the edge.

### Added - UX

- Dark mode with a three-state toggle (light / dark / system) that respects
  `prefers-color-scheme` and applies before the first paint to avoid flash.
- Toast notifications for "Scan started", "Copied", "Chat cleared",
  "Audit exported", etc.
- Keyboard shortcuts: `Cmd/Ctrl+K` to focus the chat input, `R` to run a
  new scan, `Cmd/Ctrl+Enter` to send a chat message.
- Skeleton loaders on the dashboard and landing page for a perceived
  performance boost.
- Scan-diff card. When a new scan lands, the UI shows score deltas, newly
  fixed security headers, and newly missing ones vs. the previous scan.
- Copy-as-code snippets for missing security headers (Workers, Express,
  Nginx-shaped examples) directly inside the security headers table.
- Overflow menu on the dashboard with "Export audit as JSON" and
  "Delete agent" (with confirm).
- "Clear chat" button on the chat panel.
- Accessibility and TLS cards on the dashboard showing the new scan data.
- Dark-mode-aware styling across every component.

### Added - Tooling

- Vitest config plus `test/security.test.ts` and `test/analyzer.test.ts`
  covering the pure helpers (17 tests total).
- GitHub Actions `ci` workflow running typecheck, lint, tests, Vite build,
  and `wrangler deploy --dry-run`.
- Flat-config ESLint setup and Prettier config.
- `npm run test`, `test:watch`, `lint`, `format`, and `format:check` scripts.

### Changed

- `ScanRaw` gained `accessibility`, `tls`, and `links` fields.
- `ScanInsight.issues` went from `string[]` to `InsightIssue[]`.
- `chatStream` in the Durable Object now does a tool-decision step before
  the streaming reply, and echoes the tool name in an `x-tool` response
  header.
- README refreshed to document the new features, architecture, optional
  integrations, and the development workflow.
- `heuristicScores` penalizes weak TLS when `request.cf` exposes it.

### Removed

- Old string-based `issues: string[]` shape is no longer persisted. Existing
  stored scans are migrated on read (plain strings are upgraded to
  `{ text, severity: "medium" }`).

### Fixed

- Chat replies saved as "(no reply)" on reload: the stream is now teed,
  consumed via `ctx.waitUntil()`, and parsed with a buffered SSE reader so
  the full assistant turn is always persisted.
- Chat panel overflowing the viewport: the panel has explicit height caps
  and only auto-scrolls when the user is already near the bottom.

## [1.0.0] - Initial release

- Scaffold: Cloudflare Workers + Durable Objects + Workers AI + Vite/React.
- One Durable Object per site URL, SQLite-backed memory (meta, scans, messages).
- `/api/create-agent`, `/api/scan`, `/api/history`, `/api/chat`, `/api/snapshot`.
- Landing page + per-agent dashboard, Apple-style minimal UI.
- Recent sites via `localStorage`, shareable dashboard URL per site.
- Durable Object alarms for hourly / daily autonomous rescans.
- Streaming chat via Server-Sent Events.
