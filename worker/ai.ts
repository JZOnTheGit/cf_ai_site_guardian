// thin wrapper around workers ai used by both the worker and the durable object
// we always use llama 3.3 fast variant as the default model

import {
  SCAN_SYSTEM_PROMPT,
  SCAN_CRITIC_SYSTEM_PROMPT,
  COMPARE_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  CHAT_TOOLS_SYSTEM_PROMPT,
  buildScanUserPrompt,
  buildCriticUserPrompt,
  buildCompareUserPrompt,
  buildToolsCatalog,
} from "./prompts";
import type { ScanRaw } from "./analyzer";
import { heuristicScores } from "./analyzer";

// the model id we pass to env.AI.run()
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// severity tag that rides alongside each issue so the ui can color it
export type Severity = "critical" | "high" | "medium" | "low";

// one entry in the issues array: text + severity
export interface InsightIssue {
  text: string;
  severity: Severity;
}

// shape the scan insight call returns to the rest of the app
export interface ScanInsight {
  summary: string;
  issues: InsightIssue[];
  fixes: string[];
  scores: { performance: number; security: number; seo: number };
}

// shape of the compare-two-scans response
export interface CompareInsight {
  headline: string;
  changes: string[];
  regressions: string[];
  improvements: string[];
}

// one chat turn
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// names of tools the chat agent is allowed to call
export type ChatToolName =
  | "get_latest_scan"
  | "list_history"
  | "compare_scans"
  | "request_new_scan";

// a parsed tool call from the model
export interface ChatToolCall {
  tool: ChatToolName;
  args: Record<string, unknown>;
}

// models sometimes wrap json in code fences or add chatter around it
// this tries a few ways to pull the json back out
function extractJson(text: string): any | null {
  if (!text) return null;
  // handle ```json ... ``` fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // fall through and try substring extraction
  }
  // fall back to finding the first { and last }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // give up
    }
  }
  return null;
}

// calls the llm and returns plain text, also logs basic telemetry
async function runLlm(
  ai: Ai,
  messages: ChatMessage[],
  opts: { maxTokens?: number; jsonMode?: boolean; label?: string } = {},
): Promise<string> {
  const started = Date.now();
  const body: any = {
    messages,
    max_tokens: opts.maxTokens ?? 800,
  };
  // structured-json mode for calls where we want a json object back
  if (opts.jsonMode) body.response_format = { type: "json_object" };
  const res: any = await ai.run(MODEL, body);
  const elapsed = Date.now() - started;
  const text = typeof res === "string" ? res : (res.response ?? "");
  // telemetry for Workers Logs (tail -f in wrangler or observability dashboard)
  // tokens come back in res.usage when available
  const usage = (res && res.usage) || {};
  console.log(
    JSON.stringify({
      evt: "ai.run",
      label: opts.label ?? "chat",
      ms: elapsed,
      input_tokens: usage.prompt_tokens ?? null,
      output_tokens: usage.completion_tokens ?? null,
    }),
  );
  return text;
}

// ask the llm to interpret one scan, fall back to a deterministic version on any error
// also runs a critic pass to reduce hallucinations
export async function generateScanInsight(
  ai: Ai,
  scan: ScanRaw,
): Promise<ScanInsight> {
  const fallback = deterministicInsight(scan);

  // site was unreachable, no point asking the llm
  if (!scan.ok) return fallback;

  try {
    // first pass: generate the insight in structured json
    const raw = await runLlm(
      ai,
      [
        { role: "system", content: SCAN_SYSTEM_PROMPT },
        { role: "user", content: buildScanUserPrompt(scan) },
      ],
      { jsonMode: true, label: "scan.insight" },
    );
    const parsed = extractJson(raw);
    if (!parsed) return fallback;

    const firstPass = normalizeInsight(parsed, fallback);

    // second pass: critic / fact-checker. if the critic call fails, keep the first pass
    const critRaw = await runLlm(
      ai,
      [
        { role: "system", content: SCAN_CRITIC_SYSTEM_PROMPT },
        { role: "user", content: buildCriticUserPrompt(scan, firstPass) },
      ],
      { jsonMode: true, maxTokens: 800, label: "scan.critic" },
    ).catch(() => "");
    const critParsed = critRaw ? extractJson(critRaw) : null;
    return critParsed ? normalizeInsight(critParsed, firstPass) : firstPass;
  } catch {
    return fallback;
  }
}

// merge a parsed insight with a fallback so every field is present and typed
function normalizeInsight(parsed: any, fallback: ScanInsight): ScanInsight {
  return {
    summary: String(parsed.summary ?? fallback.summary),
    issues: parseIssues(parsed.issues, fallback.issues),
    fixes: Array.isArray(parsed.fixes)
      ? parsed.fixes.map(String)
      : fallback.fixes,
    scores: {
      performance: clampScore(parsed.scores?.performance, fallback.scores.performance),
      security: clampScore(parsed.scores?.security, fallback.scores.security),
      seo: clampScore(parsed.scores?.seo, fallback.scores.seo),
    },
  };
}

// accept two shapes for issues: plain strings (older data) or {text, severity}
function parseIssues(v: unknown, fallback: InsightIssue[]): InsightIssue[] {
  if (!Array.isArray(v)) return fallback;
  return v.map((entry): InsightIssue => {
    if (typeof entry === "string") {
      return { text: entry, severity: "medium" };
    }
    if (entry && typeof entry === "object") {
      const e = entry as any;
      return {
        text: String(e.text ?? e.message ?? ""),
        severity: parseSeverity(e.severity),
      };
    }
    return { text: String(entry), severity: "medium" };
  });
}

// coerce whatever the model gave us into a known severity, default medium
function parseSeverity(v: unknown): Severity {
  const s = String(v ?? "").toLowerCase();
  if (s === "critical" || s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

// ask the llm what changed between two scans
export async function generateCompareInsight(
  ai: Ai,
  previous: { raw: ScanRaw; insight: ScanInsight } | null,
  current: { raw: ScanRaw; insight: ScanInsight },
): Promise<CompareInsight | null> {
  // no previous scan means nothing to compare
  if (!previous) return null;

  const fallback = deterministicCompare(previous, current);

  try {
    const raw = await runLlm(
      ai,
      [
        { role: "system", content: COMPARE_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildCompareUserPrompt(
            { raw: previous.raw, insight: previous.insight },
            { raw: current.raw, insight: current.insight },
          ),
        },
      ],
      { maxTokens: 500, jsonMode: true, label: "scan.compare" },
    );
    const parsed = extractJson(raw);
    if (!parsed) return fallback;
    return {
      headline: String(parsed.headline ?? fallback.headline),
      changes: arr(parsed.changes, fallback.changes),
      regressions: arr(parsed.regressions, fallback.regressions),
      improvements: arr(parsed.improvements, fallback.improvements),
    };
  } catch {
    return fallback;
  }
}

// ask the model to decide between answering directly or calling a tool
// returns {tool: name, args} when a tool call was parsed, otherwise null
export async function decideChatAction(
  ai: Ai,
  context: string,
  history: ChatMessage[],
  userMessage: string,
): Promise<ChatToolCall | null> {
  const messages: ChatMessage[] = [
    { role: "system", content: CHAT_TOOLS_SYSTEM_PROMPT },
    { role: "user", content: buildToolsCatalog() },
    {
      role: "system",
      content: `Agent memory for this site (JSON):\n${context}`,
    },
    ...history.slice(-10),
    { role: "user", content: userMessage },
  ];
  const text = await runLlm(ai, messages, {
    maxTokens: 200,
    jsonMode: true,
    label: "chat.decide",
  });
  const parsed = extractJson(text);
  // only treat it as a tool call if the shape matches
  if (
    parsed &&
    typeof parsed.tool === "string" &&
    isKnownTool(parsed.tool) &&
    typeof parsed.args === "object" &&
    parsed.args !== null
  ) {
    return { tool: parsed.tool, args: parsed.args as Record<string, unknown> };
  }
  return null;
}

// guard that narrows an arbitrary string to a tool name
function isKnownTool(name: string): name is ChatToolName {
  return (
    name === "get_latest_scan" ||
    name === "list_history" ||
    name === "compare_scans" ||
    name === "request_new_scan"
  );
}

// streaming chat turn with the stored history + fresh site context injected
// the caller is expected to pipe this back to the browser
export async function runChatStream(
  ai: Ai,
  context: string,
  history: ChatMessage[],
  userMessage: string,
): Promise<ReadableStream<Uint8Array>> {
  const messages: ChatMessage[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    {
      role: "system",
      content: `Agent memory for this site (JSON):\n${context}`,
    },
    ...history.slice(-10),
    { role: "user", content: userMessage },
  ];
  // ask workers ai for a streaming response
  const stream = (await ai.run(MODEL, {
    messages,
    max_tokens: 600,
    stream: true,
  })) as unknown as ReadableStream<Uint8Array>;
  return stream;
}

// ---------- helpers ----------

// make sure score is a number in 0..100
function clampScore(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// coerce a value into a string array or use fallback
function arr(v: unknown, fallback: string[]): string[] {
  return Array.isArray(v) ? v.map(String) : fallback;
}

// builds a basic insight without calling the llm at all
function deterministicInsight(scan: ScanRaw): ScanInsight {
  const scores = heuristicScores(scan);
  const issues: InsightIssue[] = [];
  const fixes: string[] = [];

  // site unreachable branch
  if (!scan.ok) {
    return {
      summary: `Could not reach ${scan.url}${scan.error ? ` (${scan.error})` : ""}.`,
      issues: [
        { text: "Site unreachable or returned a non-2xx status.", severity: "critical" },
      ],
      fixes: ["Verify DNS, TLS certificate, and that the origin is up."],
      scores,
    };
  }

  // one issue + fix pair for every missing security header
  for (const h of scan.security.headers) {
    if (!h.present) {
      issues.push({
        text: `Missing ${h.header} header.`,
        severity: mapHeaderSeverity(h.severity),
      });
      fixes.push(`Set the ${h.header} response header. ${h.description}`);
    }
  }

  // simple perf checks
  if (scan.performance.ttfbMs > 1000) {
    issues.push({
      text: `Slow TTFB (${scan.performance.ttfbMs} ms).`,
      severity: scan.performance.ttfbMs > 2000 ? "high" : "medium",
    });
    fixes.push("Cache HTML at the edge or reduce origin work on the first byte.");
  }
  if (!scan.performance.compression) {
    issues.push({ text: "No response compression detected.", severity: "medium" });
    fixes.push("Enable gzip or Brotli compression at the origin / CDN.");
  }

  // basic seo checks
  if (!scan.seo.title) {
    issues.push({ text: "Missing <title>.", severity: "high" });
    fixes.push("Add a descriptive <title> tag (40-60 chars).");
  }
  if (!scan.seo.metaDescription) {
    issues.push({ text: "Missing meta description.", severity: "medium" });
    fixes.push("Add <meta name=\"description\"> (120-160 chars).");
  }
  if (scan.seo.h1Count !== 1) {
    issues.push({
      text: `Found ${scan.seo.h1Count} <h1> tags (ideal: exactly 1).`,
      severity: "low",
    });
    fixes.push("Use exactly one <h1> per page.");
  }
  if (!scan.seo.hasViewport) {
    issues.push({ text: "Missing viewport meta tag.", severity: "medium" });
    fixes.push(
      "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.",
    );
  }

  // accessibility issues roll in here too
  for (const a of scan.accessibility.issues) {
    issues.push({ text: `a11y: ${a.message}`, severity: a.severity });
    fixes.push(`Address accessibility issue: ${a.message}`);
  }

  // broken links are reported as one grouped issue with per-url evidence
  if (scan.links.broken.length > 0) {
    const preview = scan.links.broken
      .slice(0, 3)
      .map((l) => `${l.url} (${l.status})`)
      .join(", ");
    issues.push({
      text: `${scan.links.broken.length} broken internal link(s): ${preview}`,
      severity: "medium",
    });
    fixes.push("Fix or remove broken links, or update them to the canonical URL.");
  }

  return {
    summary: `Scanned ${scan.url}: status ${scan.status}, TTFB ${scan.performance.ttfbMs} ms, ${scan.security.missingCount} missing security headers, ${scan.accessibility.issues.length} a11y issue(s).`,
    issues,
    fixes,
    scores,
  };
}

// map a security-header severity onto the insight severity scale
function mapHeaderSeverity(s: "high" | "medium" | "low"): Severity {
  return s;
}

// same idea but for comparing two scans without the llm
function deterministicCompare(
  previous: { raw: ScanRaw; insight: ScanInsight },
  current: { raw: ScanRaw; insight: ScanInsight },
): CompareInsight {
  const changes: string[] = [];
  const regressions: string[] = [];
  const improvements: string[] = [];

  // flag meaningful ttfb swings
  const dTtfb = current.raw.performance.ttfbMs - previous.raw.performance.ttfbMs;
  if (Math.abs(dTtfb) >= 150) {
    const line = `TTFB changed by ${dTtfb > 0 ? "+" : ""}${dTtfb} ms (${previous.raw.performance.ttfbMs} -> ${current.raw.performance.ttfbMs}).`;
    changes.push(line);
    (dTtfb > 0 ? regressions : improvements).push(line);
  }

  // diff the set of missing headers between the two scans
  const prevMissing = new Set(
    previous.raw.security.headers.filter((h) => !h.present).map((h) => h.header),
  );
  const currMissing = new Set(
    current.raw.security.headers.filter((h) => !h.present).map((h) => h.header),
  );
  for (const h of currMissing)
    if (!prevMissing.has(h)) regressions.push(`New missing security header: ${h}.`);
  for (const h of prevMissing)
    if (!currMissing.has(h)) improvements.push(`Security header now present: ${h}.`);

  // pick a short headline based on what we found
  const headline =
    regressions.length > 0
      ? `Regressions detected in the latest scan.`
      : improvements.length > 0
        ? `Site improved since last scan.`
        : `No meaningful changes since last scan.`;

  return { headline, changes, regressions, improvements };
}
