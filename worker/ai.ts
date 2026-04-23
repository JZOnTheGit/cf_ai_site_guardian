// thin wrapper around workers ai used by both the worker and the durable object
// we always use llama 3.3 fast variant as the default model

import {
  SCAN_SYSTEM_PROMPT,
  COMPARE_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  buildScanUserPrompt,
  buildCompareUserPrompt,
} from "./prompts";
import type { ScanRaw } from "./analyzer";
import { heuristicScores } from "./analyzer";

// the model id we pass to env.AI.run()
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// shape the scan insight call returns to the rest of the app
export interface ScanInsight {
  summary: string;
  issues: string[];
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

// models sometimes wrap json in code fences or add chatter around it
// this tries a few ways to pull the json back out
function extractJson(text: string): any | null {
  if (!text) return null;
  // handle ```json ... ``` fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {}
  // fall back to finding the first { and last }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {}
  }
  return null;
}

// calls the llm and returns plain text
async function runLlm(
  ai: Ai,
  messages: ChatMessage[],
  opts: { maxTokens?: number } = {},
): Promise<string> {
  const res: any = await ai.run(MODEL, {
    messages,
    max_tokens: opts.maxTokens ?? 800,
  });
  return typeof res === "string" ? res : (res.response ?? "");
}

// ask the llm to interpret one scan, fall back to a deterministic version on any error
export async function generateScanInsight(
  ai: Ai,
  scan: ScanRaw,
): Promise<ScanInsight> {
  const fallback = deterministicInsight(scan);

  // site was unreachable, no point asking the llm
  if (!scan.ok) return fallback;

  try {
    // send system + user, ask for json back
    const raw = await runLlm(ai, [
      { role: "system", content: SCAN_SYSTEM_PROMPT },
      { role: "user", content: buildScanUserPrompt(scan) },
    ]);
    const parsed = extractJson(raw);
    if (!parsed) return fallback;

    // merge whatever we got with the fallback so every field is present
    return {
      summary: String(parsed.summary ?? fallback.summary),
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map(String)
        : fallback.issues,
      fixes: Array.isArray(parsed.fixes) ? parsed.fixes.map(String) : fallback.fixes,
      scores: {
        performance: clampScore(parsed.scores?.performance, fallback.scores.performance),
        security: clampScore(parsed.scores?.security, fallback.scores.security),
        seo: clampScore(parsed.scores?.seo, fallback.scores.seo),
      },
    };
  } catch {
    return fallback;
  }
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
      { maxTokens: 500 },
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

// chat turn with the stored history + fresh site context injected
export async function runChat(
  ai: Ai,
  context: string,
  history: ChatMessage[],
  userMessage: string,
): Promise<string> {
  // build the full message array for the model
  const messages: ChatMessage[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    {
      role: "system",
      content: `Agent memory for this site (JSON):\n${context}`,
    },
    // only keep the last 10 turns so the context stays small
    ...history.slice(-10),
    { role: "user", content: userMessage },
  ];
  const text = await runLlm(ai, messages, { maxTokens: 600 });
  return (text || "").trim();
}

// streaming variant of runChat, returns the raw SSE stream from workers ai
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
  const issues: string[] = [];
  const fixes: string[] = [];

  // site unreachable branch
  if (!scan.ok) {
    return {
      summary: `Could not reach ${scan.url}${scan.error ? ` (${scan.error})` : ""}.`,
      issues: ["Site unreachable or returned a non-2xx status."],
      fixes: ["Verify DNS, TLS certificate, and that the origin is up."],
      scores,
    };
  }

  // one issue + fix pair for every missing security header
  for (const h of scan.security.headers) {
    if (!h.present) {
      issues.push(`Missing ${h.header} header (${h.severity}).`);
      fixes.push(`Set the ${h.header} response header. ${h.description}`);
    }
  }

  // simple perf checks
  if (scan.performance.ttfbMs > 1000) {
    issues.push(`Slow TTFB (${scan.performance.ttfbMs} ms).`);
    fixes.push("Cache HTML at the edge or reduce origin work on the first byte.");
  }
  if (!scan.performance.compression) {
    issues.push("No response compression detected.");
    fixes.push("Enable gzip or Brotli compression at the origin / CDN.");
  }

  // basic seo checks
  if (!scan.seo.title) {
    issues.push("Missing <title>.");
    fixes.push("Add a descriptive <title> tag (40-60 chars).");
  }
  if (!scan.seo.metaDescription) {
    issues.push("Missing meta description.");
    fixes.push("Add <meta name=\"description\"> (120-160 chars).");
  }
  if (scan.seo.h1Count !== 1) {
    issues.push(`Found ${scan.seo.h1Count} <h1> tags (ideal: exactly 1).`);
    fixes.push("Use exactly one <h1> per page.");
  }
  if (!scan.seo.hasViewport) {
    issues.push("Missing viewport meta tag.");
    fixes.push("Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.");
  }

  return {
    summary: `Scanned ${scan.url}: status ${scan.status}, TTFB ${scan.performance.ttfbMs} ms, ${scan.security.missingCount} missing security headers.`,
    issues,
    fixes,
    scores,
  };
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
