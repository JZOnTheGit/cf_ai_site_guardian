# cf_ai_site_guardian

### [Try it live: cf-ai-site-guardian.jass150505.workers.dev](https://cf-ai-site-guardian.jass150505.workers.dev)

[![Live on Cloudflare](https://img.shields.io/badge/Live-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](https://cf-ai-site-guardian.jass150505.workers.dev)
[![Workers AI](https://img.shields.io/badge/Workers%20AI-Llama%203.3-0a84ff)](https://developers.cloudflare.com/workers-ai/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**Site Guardian** is a full-stack AI agent built on Cloudflare that continuously
monitors a website's performance, security, accessibility, TLS posture, and
basic SEO - and explains what to fix in plain English.

You paste a URL, Site Guardian spins up a dedicated **Durable Object** for that
site, runs an initial scan, asks **Workers AI** (Llama 3.3) to interpret the
results, fact-checks itself against the raw data, and remembers everything so
it can tell you how the site has changed over time. The chat panel is a
tool-using agent: it can answer from context, pull history, diff two scans,
or kick off a fresh scan on its own.

---

## Live demo

Open **[cf-ai-site-guardian.jass150505.workers.dev](https://cf-ai-site-guardian.jass150505.workers.dev)**, paste any URL (try your own site or `example.com`), and the agent will:

1. Spin up a fresh Durable Object instance for that URL
2. Fetch the site, measure TTFB, inspect security headers, accessibility,
   TLS/HTTP version, and sample internal links
3. Ask Llama 3.3 for a summary, severity-tagged issues, fixes, and 0-100 scores
4. Run a second LLM pass that fact-checks the first against the raw scan
5. Let you chat with the agent - the chat can autonomously call tools for
   history, diffs, or fresh scans

Click **Run new scan** any time (or press `R`) to add a new entry to the
timeline. The dashboard will show a diff card with score deltas and header
changes vs. the previous scan.

> Repo name is prefixed with `cf_ai_` per the assignment spec.

---

## What's new in 1.1.0

See [`CHANGELOG.md`](./CHANGELOG.md) for the full list. Highlights:

- **AI tool-use**: the chat agent can call `get_latest_scan`, `list_history`,
  `compare_scans`, or `request_new_scan` mid-conversation, and the UI labels
  which tool was used.
- **Self-critique pass** on every scan insight to cut hallucinations.
- **Severity on every issue** rendered as colored chips.
- **Structured JSON** output mode plus lightweight AI telemetry logs.
- **Deeper scans**: accessibility audit, TLS / HTTP version / cipher /
  Cloudflare colo, and broken link detection.
- **Hardening**: SSRF allow/deny list, fetch timeout + body caps, rate
  limiting, CSRF origin checks, hex-validated agent IDs, DO storage caps.
- **Dark mode** with a three-state toggle (light / dark / system),
  **toast notifications**, **keyboard shortcuts** (`Cmd/Ctrl+K`, `R`,
  `Cmd/Ctrl+Enter`), **skeleton loaders**, **scan diff card**,
  **copy-as-code snippets** for fixing security headers, **export-as-JSON**
  and **delete-agent** actions.
- **Platform**: cron trigger safety-net, long-lived cache headers for
  hashed Vite assets, and a preload hint for HTML.
- **Tests + CI**: Vitest suite (17 tests covering the security and
  analyzer helpers), GitHub Actions workflow running typecheck, lint,
  tests, build, and `wrangler deploy --dry-run`.
- **Tooling**: flat-config ESLint, Prettier, `npm test`, `npm run lint`,
  `npm run format`.

---

## Architecture

```
+--------------+        /api/*         +------------------------+
|  React SPA   | --------------------> |  Cloudflare Worker     |
| (Vite + Tail)|<------  JSON / SSE ---|  worker/index.ts       |
+--------------+                        +----------+-------------+
                                                   | stub.fetch
                                                   v
                                        +------------------------+
                                        |  Durable Object:       |
                                        |  SiteAgent             |
                                        |  worker/agent.ts       |
                                        |   - SQLite:            |
                                        |     meta, scans,       |
                                        |     messages, settings |
                                        |   - runScan()          |
                                        |   - chatStream()       |
                                        |     (tool-decision +   |
                                        |      streaming reply)  |
                                        |   - alarm() autopilot  |
                                        +----------+-------------+
                                                   |
                                           +-------+-------+
                                           v               v
                                      +--------+      +--------+
                                      | fetch()|      |Workers |
                                      | target |      |  AI    |
                                      |  site  |      |(Llama) |
                                      +--------+      +--------+
```

### What each piece does

- **React SPA** (`src/`): landing page with URL input and a dashboard with
  scores, severity-tagged issues, fixes, security headers, SEO details,
  accessibility card, TLS card, scan history, scan-diff card, and a tool-aware
  AI chat panel. Tailwind-based Apple-style UI with dark mode.
- **Worker** (`worker/index.ts`): thin HTTP layer. Turns `/api/*` requests
  into calls on the right `SiteAgent` Durable Object, enforces rate limits,
  CSRF and input validation at the edge, and adds cache + preload headers
  on the SPA shell. Also owns the `scheduled` cron handler.
- **SiteAgent Durable Object** (`worker/agent.ts`): the actual agent. One
  instance per monitored URL (deterministic id from the URL). Owns a SQLite
  database holding `meta`, `scans`, `messages`, and `settings`. Runs scans,
  decides whether chat turns need tools, streams replies, and autonomously
  rescans via `storage.setAlarm()`.
- **Scanner** (`worker/analyzer.ts`): fetches the target site with hard
  timeout and body caps, times the response, inspects security headers (CSP,
  HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy), pulls SEO signals, runs a heuristic accessibility
  audit, reads TLS/HTTP info from `request.cf`, and samples internal links.
- **AI layer** (`worker/ai.ts` + `worker/prompts.ts`): calls
  `@cf/meta/llama-3.3-70b-instruct-fp8-fast` on Workers AI with structured
  prompts to produce:
  1. A scan insight (summary, severity-tagged issues, fixes, 0-100 scores),
     followed by a strict critic pass against the raw data.
  2. A compare insight when a previous scan exists (what changed, regressions,
     improvements).
  3. A tool-decision step for chat, then a streaming reply that is grounded
     in the agent's stored memory plus any tool results.

Every LLM call has a deterministic fallback, so the UI still works even if
the model fails or returns malformed JSON.

### How Durable Objects are used

Each site the user submits maps deterministically to a single Durable Object
instance via `env.SITE_AGENT.idFromName(normalizedUrl)`. That means:

- Submitting the same URL twice returns the same agent (with its full history).
- Each site gets its own isolated memory, so scans and chat transcripts never
  bleed across sites.
- All scan/chat logic runs inside the Durable Object, so state reads and
  writes are strongly consistent without any external DB.

The Durable Object stores data in its built-in **SQLite** storage (enabled via
the `new_sqlite_classes` migration in `wrangler.toml`). Four tables are used:
`meta`, `scans`, `messages`, and `settings`. Messages and scans are capped
at a fixed size so long-lived agents cannot grow unbounded.

### How AI is used

Workers AI is used for five distinct prompts (all documented verbatim in
[`PROMPTS.md`](./PROMPTS.md)):

1. **Scan insight (first pass)** - structured JSON: summary, severity-tagged
   issues, fixes, and 0-100 scores.
2. **Scan critic (second pass)** - strict fact-checker over the first pass
   against the raw scan data.
3. **Compare insight** - given previous and current scan, explain the delta.
4. **Chat direct-answer mode** - a context-aware assistant streamed via SSE.
5. **Chat tool-use mode** - a pre-step that lets the model choose to call
   one of the agent's internal tools before the streaming reply.

All JSON prompts use `response_format: { type: "json_object" }` when
available and every response is parsed and validated; if the output cannot
be parsed, the deterministic fallback is used so the UI never breaks. AI
telemetry (duration and token usage) is logged to Workers logs for every
call.

---

## Core features

- **Input + dashboard**: paste a URL on `/`, get redirected to
  `/site/:agentId` where the agent for that site lives.
- **Initial scan on submit**: when a fresh agent has no history, the
  dashboard auto-triggers the first scan.
- **Agent memory**: every scan is persisted in the Durable Object, with
  timestamps, full raw data, and the AI's interpretation (including
  severities).
- **Autonomous monitoring via Durable Object alarms**: the dashboard has an
  "auto-scan" selector (Off / 1h / 6h / 24h). When turned on, the Durable
  Object calls `ctx.storage.setAlarm()` and its `alarm()` handler runs a
  scan on schedule and reschedules itself. This runs on Cloudflare's
  infrastructure, independent of any open browser tab. An hourly cron
  trigger is also declared in `wrangler.toml` as a belt-and-suspenders
  safety net.
- **Score trend sparklines + delta arrows**: each score card shows a small
  inline sparkline of recent scans plus an up/down delta vs the previous
  scan, so you can see improvement or regression at a glance.
- **Scan-diff card**: when a new scan lands, the dashboard shows score
  deltas and any security headers that were newly fixed or newly dropped
  vs. the previous scan.
- **Streaming chat with tool-use**: chat replies stream token-by-token via
  SSE. Before streaming, the model decides whether to call one of the
  agent's tools (`get_latest_scan`, `list_history`, `compare_scans`,
  `request_new_scan`). The UI labels the bubble with the tool name. All
  messages persist in SQLite.
- **Multi-site support**: monitor as many sites as you like. Each URL maps
  deterministically to its own Durable Object so each site has its own
  isolated scan history, chat transcript, and auto-scan schedule.
- **Recent-sites list**: the browser remembers agents you've opened via
  `localStorage`. The data itself still lives in the Durable Object; the
  list is just a bookmark index.
- **Shareable permanent links**: the dashboard URL `/site/:agentId` is a
  permanent handle to that agent's memory. Bookmark it, share it, or paste
  the original site URL on `/` at any time to reconnect with the same
  agent and its full history.
- **Copy-as-code fixes**: for every missing security header the table has a
  "Copy fix" button that expands a ready-to-paste snippet (Workers,
  Express, or Nginx flavored).
- **Clear chat / delete agent / export audit**: an overflow menu on the
  dashboard can export the agent's full state as JSON or permanently
  delete it (with confirmation).
- **Dark mode** with a three-state toggle (light / dark / system) that
  respects `prefers-color-scheme` and applies before the first paint.
- **Keyboard shortcuts**: `Cmd/Ctrl+K` focuses the chat input, `R` triggers
  a new scan, `Cmd/Ctrl+Enter` sends a chat message.

---

## Project structure

```
cf_ai_site_guardian/
|-- index.html                  # Vite entry
|-- src/                        # React SPA
|   |-- main.tsx                # initTheme() + router
|   |-- index.css               # tailwind + dark mode tokens
|   |-- lib/
|   |   |-- api.ts              # typed client for /api/*
|   |   |-- storage.ts          # localStorage recent-sites
|   |   |-- theme.ts            # dark mode controller
|   |   \-- shortcuts.ts        # useHotkey hook
|   |-- pages/
|   |   |-- Landing.tsx
|   |   \-- Dashboard.tsx
|   \-- components/
|       |-- ChatPanel.tsx       # streaming + tool-use chat
|       |-- IssueList.tsx       # severity chips
|       |-- ScoreCard.tsx       # sparkline + delta
|       |-- SecurityHeaders.tsx # copy-as-code snippets
|       |-- ScanDiff.tsx        # new vs previous
|       |-- Timeline.tsx
|       |-- RecentSites.tsx
|       |-- ShareLinkCard.tsx
|       |-- AutoScanControl.tsx
|       |-- DarkModeToggle.tsx
|       |-- SkeletonLoader.tsx
|       |-- Sparkline.tsx
|       |-- Toast.tsx           # useToast + useCopyFlash
|       \-- CopyCodeSnippet.tsx
|-- worker/                     # Cloudflare Worker
|   |-- index.ts                # routes, security, caching, cron
|   |-- agent.ts                # SiteAgent Durable Object
|   |-- analyzer.ts             # scan: perf / sec / seo / a11y / tls / links
|   |-- ai.ts                   # Workers AI wrapper, tool-decision, telemetry
|   |-- prompts.ts              # every LLM prompt
|   \-- security.ts             # ssrf, csrf, rate limit, validation
|-- test/                       # vitest unit tests
|   |-- security.test.ts
|   \-- analyzer.test.ts
|-- .github/workflows/ci.yml
|-- wrangler.toml
|-- vite.config.ts
|-- tailwind.config.js
|-- postcss.config.js
|-- eslint.config.js
|-- .prettierrc.json
|-- vitest.config.ts
|-- tsconfig.json
|-- package.json
|-- README.md
|-- CHANGELOG.md
\-- PROMPTS.md                  # all AI prompts, verbatim
```

---

## Setup

Requirements: Node 20+ and a Cloudflare account.

```bash
# 1. install dependencies
npm install

# 2. authenticate wrangler (opens a browser once)
npx wrangler login
```

No API keys are required. Workers AI is the LLM provider and it authenticates
through your Cloudflare account.

## Run locally

Two processes, two terminals:

```bash
# terminal 1: build + watch the vite frontend
npm run dev
# -> http://localhost:5173

# terminal 2: run the worker + durable object + workers ai locally
npm run dev:worker
# -> http://localhost:8787
```

Open http://localhost:5173 - the Vite dev server proxies `/api/*` to
the Worker at `:8787`, so everything works end-to-end.

> Workers AI is invoked through your Cloudflare account even in local dev.
> If you want fully offline dev, you can temporarily short-circuit `runLlm`
> in `worker/ai.ts` to return `""`; the deterministic fallbacks will still
> provide usable scan summaries and scores.

## Quality and tests

```bash
npm run typecheck   # wrangler types + tsc --noEmit
npm run lint        # eslint flat config
npm run format      # prettier --write
npm test            # vitest run
npm run build       # vite build
npx wrangler deploy --dry-run
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push and
pull request.

## Deploy

```bash
npm run deploy
```

This runs `vite build` and then `wrangler deploy`, which:

1. Uploads the built SPA from `./dist` as static assets (with long-lived
   cache headers on hashed files).
2. Uploads the Worker.
3. Creates / migrates the `SiteAgent` Durable Object class.
4. Registers the hourly cron trigger.

Your app will be live at `https://cf-ai-site-guardian.<your-subdomain>.workers.dev`.
The current deployment lives at **[cf-ai-site-guardian.jass150505.workers.dev](https://cf-ai-site-guardian.jass150505.workers.dev)**.

---

## API reference

| Method | Path                 | Body / Query                                | Returns                          |
| ------ | -------------------- | ------------------------------------------- | -------------------------------- |
| POST   | `/api/create-agent`  | `{ url }`                                   | `{ agentId, url, createdAt }`    |
| POST   | `/api/scan`          | `{ agentId }`                               | `ScanRecord`                     |
| GET    | `/api/snapshot?id=`  | -                                           | `AgentSnapshot` (incl. settings) |
| GET    | `/api/history?id=`   | -                                           | `ScanRecord[]`                   |
| GET    | `/api/messages?id=`  | -                                           | `ChatMessage[]`                  |
| POST   | `/api/chat`          | `{ agentId, message }`                      | `text/event-stream` (SSE) + `x-tool` header |
| POST   | `/api/settings`      | `{ agentId, autoScanIntervalHours }`        | `AgentSettings`                  |
| POST   | `/api/clear-chat`    | `{ agentId }`                               | `{ ok: true }`                   |
| POST   | `/api/delete-agent`  | `{ agentId }`                               | `{ ok: true }`                   |
| GET    | `/api/export?id=`    | -                                           | `application/json` full dump     |

Mutating endpoints enforce rate limits per IP, a same-origin check, hex
agent-id validation, and SSRF protection on URLs. Type definitions live in
`src/lib/api.ts` and mirror `worker/agent.ts` / `worker/ai.ts`.

---

## Design notes

- **Apple-style minimal UI**: soft gray background, rounded cards, subtle
  shadows, Inter typography, full-width pill buttons, smooth fade-in on
  page load. Tailwind is configured with a custom `ink` neutral scale, a
  single `accent` blue, and `darkMode: "class"`.
- **Resilience over cleverness**: every AI call has a deterministic
  fallback; the heuristic scorer in `analyzer.ts` always produces useful
  numbers, so a dashboard is never empty.
- **Single source of truth for prompts**: all prompts live in
  `worker/prompts.ts` and are reproduced verbatim in `PROMPTS.md`.
- **Security first**: the Worker enforces SSRF, CSRF, rate limits, input
  validation, body-size caps, and timeouts before any user input reaches
  the Durable Object or the LLM.

---

## License

MIT
