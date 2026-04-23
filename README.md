# cf_ai_site_guardian

**Site Guardian** is a full-stack AI agent built on Cloudflare that continuously
monitors a website's performance, security, and basic SEO, and explains what
to fix in plain English.

You paste a URL, Site Guardian spins up a dedicated **Durable Object** for that
site, runs an initial scan, asks **Workers AI** (Llama 3.3) to interpret the
results, and remembers everything so it can tell you how the site has changed
over time. You can also chat with the agent; answers are always grounded in the
site's real scan history.

---

## Live demo

- Deployed URL: _(fill in after your first `npm run deploy`)_
- Repo name is prefixed with `cf_ai_` per the assignment spec.

## Screenshots

Add a screenshot or GIF of:

1. The landing page (`/`)
2. A live dashboard (`/site/:agentId`) with scores, issues, and the chat panel

A full-resolution dashboard mockup is included in `../assets/` for reference.

---

## Architecture

```
+--------------+        /api/*         +------------------------+
|  React SPA   | --------------------> |  Cloudflare Worker     |
| (Vite + Tail)|<------  JSON  --------|  worker/index.ts       |
+--------------+                        +----------+-------------+
                                                   | stub.fetch
                                                   v
                                        +------------------------+
                                        |  Durable Object:       |
                                        |  SiteAgent             |
                                        |  worker/agent.ts       |
                                        |   - SQLite: meta,      |
                                        |     scans, messages    |
                                        |   - runScan()          |
                                        |   - LLM insight & chat |
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
  scores, issues, fixes, security headers, SEO details, scan history, and an
  AI chat panel. Built with Vite + Tailwind, served by the Worker as static
  assets.
- **Worker** (`worker/index.ts`): thin HTTP layer. Turns `/api/*` requests
  into calls on the right `SiteAgent` Durable Object. Everything else is
  proxied to the static assets binding, with SPA fallback.
- **SiteAgent Durable Object** (`worker/agent.ts`): the actual agent. One
  instance per monitored URL (deterministic id from the URL), owns a SQLite
  database holding:
  - `meta`: the URL and createdAt timestamp
  - `scans`: every scan performed (raw HTTP data + AI insight + compare-to-previous insight)
  - `messages`: the chat transcript so the agent has persistent memory
- **Scanner** (`worker/analyzer.ts`): fetches the target site, times the
  response, inspects security headers (CSP, HSTS, X-Frame-Options,
  X-Content-Type-Options, Referrer-Policy, Permissions-Policy), and pulls
  basic SEO signals (title, meta description, h1 count, viewport, canonical,
  og tags, lang) from the HTML.
- **AI layer** (`worker/ai.ts` + `worker/prompts.ts`): calls
  `@cf/meta/llama-3.3-70b-instruct-fp8-fast` on Workers AI with structured
  prompts to produce:
  1. A scan insight (summary, issues, fixes, 0-100 scores)
  2. A compare insight when a previous scan exists (what changed, regressions,
     improvements)
  3. Chat replies grounded in the agent's stored memory
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
the `new_sqlite_classes` migration in `wrangler.toml`). We use three tables:
`meta`, `scans`, and `messages`.

### How AI is used

Workers AI is used for three distinct prompts (all documented in `PROMPTS.md`):

1. **Scan insight**: turn structured scan JSON into a summary, issues, fixes,
   and 0-100 scores.
2. **Compare insight**: given the previous and current scan, explain the
   delta (regressions, improvements, likely causes).
3. **Chat**: a context-aware assistant that answers questions about the
   site. Its system prompt forbids inventing data, and the user's live
   snapshot (latest scan + recent history) is injected as a system message.

All prompts enforce a JSON output schema and the server parses/validates the
response; if the LLM output can't be parsed, the deterministic fallback is
used so the UI never breaks.

---

## Core features

- **Input + dashboard**: paste a URL on `/`, get redirected to
  `/site/:agentId` where the agent for that site lives.
- **Initial scan on submit**: when a fresh agent has no history, the
  dashboard auto-triggers the first scan.
- **Agent memory**: every scan is persisted in the Durable Object, with
  timestamps, full raw data, and the AI's interpretation.
- **Autonomous monitoring (on-demand simulated schedule)**: the "Run new
  scan" button triggers a new scan; the agent automatically compares it to
  the previous one and surfaces regressions / improvements. The same code
  path could be wired to a Cron Trigger or `ctx.storage.setAlarm()` for
  continuous scheduled checks.
- **Chat interface**: grounded, context-aware chat over the site's memory.
  Quick-start prompts are provided; the agent refuses to answer questions
  it doesn't have data for.

---

## Project structure

```
cf_ai_site_guardian/
├── index.html             # Vite entry
├── src/                   # React SPA
│   ├── main.tsx
│   ├── index.css
│   ├── lib/api.ts         # typed client for /api/*
│   ├── pages/
│   │   ├── Landing.tsx
│   │   └── Dashboard.tsx
│   └── components/
│       ├── ChatPanel.tsx
│       ├── IssueList.tsx
│       ├── ScoreCard.tsx
│       ├── SecurityHeaders.tsx
│       └── Timeline.tsx
├── worker/                # Cloudflare Worker
│   ├── index.ts           # API routes + static asset passthrough
│   ├── agent.ts           # SiteAgent Durable Object
│   ├── analyzer.ts        # deterministic site scan
│   ├── ai.ts              # Workers AI wrapper + fallbacks
│   ├── prompts.ts         # all LLM prompts
│   └── env.d.ts           # bindings type
├── wrangler.toml
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── package.json
├── README.md
└── PROMPTS.md             # all AI prompts, verbatim
```

---

## Setup

Requirements: Node 20+ and a Cloudflare account.

```bash
# 1. Install dependencies
npm install

# 2. Authenticate Wrangler (opens a browser once)
npx wrangler login
```

No API keys are required, Workers AI is the LLM provider and it authenticates
through your Cloudflare account.

## Run locally

Two processes, two terminals:

```bash
# Terminal 1: build + watch the Vite frontend
npm run dev
# -> http://localhost:5173

# Terminal 2: run the Worker + Durable Object + Workers AI locally
npm run dev:worker
# -> http://localhost:8787
```

Open http://localhost:5173, the Vite dev server proxies `/api/*` to
the Worker at `:8787`, so everything works end-to-end.

> Workers AI is invoked through your Cloudflare account even in local dev. If
> you want fully offline dev, you can temporarily short-circuit `runLlm` in
> `worker/ai.ts` to return `""`, the deterministic fallbacks will still
> provide usable scan summaries and scores.

## Deploy

```bash
npm run deploy
```

This runs `vite build` and then `wrangler deploy`, which:

1. Uploads the built SPA from `./dist` as static assets.
2. Uploads the Worker.
3. Creates / migrates the `SiteAgent` Durable Object class.

Your app will be live at `https://cf-ai-site-guardian.<your-subdomain>.workers.dev`.

---

## API reference

| Method | Path                 | Body                      | Returns                         |
| ------ | -------------------- | ------------------------- | ------------------------------- |
| POST   | `/api/create-agent`  | `{ url }`                 | `{ agentId, url, createdAt }`   |
| POST   | `/api/scan`          | `{ agentId }`             | `ScanRecord`                    |
| GET    | `/api/snapshot?id=`  | -                         | `AgentSnapshot`                 |
| GET    | `/api/history?id=`   | -                         | `ScanRecord[]`                  |
| GET    | `/api/messages?id=`  | -                         | `ChatMessage[]`                 |
| POST   | `/api/chat`          | `{ agentId, message }`    | `{ reply, history }`            |

Type definitions live in `src/lib/api.ts` and mirror `worker/agent.ts` /
`worker/ai.ts`.

---

## Design notes

- **Apple-style minimal UI**: soft gray background, rounded cards, subtle
  shadows, Inter typography, full-width pill buttons, smooth fade-in on
  page load. Tailwind is configured with a custom `ink` neutral scale and a
  single `accent` blue.
- **Resilience over cleverness**: every AI call has a deterministic
  fallback; the heuristic scorer in `analyzer.ts` always produces useful
  numbers, so a dashboard is never empty.
- **Single source of truth for prompts**: all prompts live in
  `worker/prompts.ts` and are reproduced verbatim in `PROMPTS.md`.

---

## License

MIT
