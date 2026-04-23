// typed client for the worker's /api/* routes
// mirrors the shapes returned from worker/agent.ts

// one row describing a security header check result
export interface SecurityHeaderCheck {
  header: string;
  present: boolean;
  value: string | null;
  severity: "high" | "medium" | "low";
  description: string;
}

// the big raw scan object returned by the analyzer
export interface ScanRaw {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  ttfbMs: number;
  totalMs: number;
  htmlBytes: number;
  contentType: string | null;
  server: string | null;
  security: { headers: SecurityHeaderCheck[]; missingCount: number };
  performance: {
    ttfbMs: number;
    totalMs: number;
    htmlBytes: number;
    estimatedAssetCount: number;
    compression: string | null;
  };
  seo: {
    title: string | null;
    titleLength: number;
    metaDescription: string | null;
    metaDescriptionLength: number;
    h1Count: number;
    h2Count: number;
    hasViewport: boolean;
    hasCanonical: boolean;
    hasOgTitle: boolean;
    hasOgDescription: boolean;
    lang: string | null;
  };
  error?: string;
}

// what the llm (or fallback) produces for one scan
export interface ScanInsight {
  summary: string;
  issues: string[];
  fixes: string[];
  scores: { performance: number; security: number; seo: number };
}

// what the llm returns when comparing two scans
export interface CompareInsight {
  headline: string;
  changes: string[];
  regressions: string[];
  improvements: string[];
}

// one stored scan with everything the ui needs
export interface ScanRecord {
  id: string;
  at: number;
  raw: ScanRaw;
  insight: ScanInsight;
  compare: CompareInsight | null;
}

// the shape /api/snapshot returns
export interface AgentSnapshot {
  meta: { url: string; createdAt: number } | null;
  latest: ScanRecord | null;
  history: Array<{
    id: string;
    at: number;
    scores: ScanInsight["scores"];
    status: number;
    ok: boolean;
  }>;
}

// one chat turn as stored in the DO
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// little wrapper around fetch that parses json and throws on errors
async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text || `request failed: ${res.status}`);
  }
  if (!res.ok) throw new Error(body?.error ?? `request failed: ${res.status}`);
  return body as T;
}

// all api calls the frontend makes, in one object
export const api = {
  // create or fetch an agent for a site url
  createAgent: (url: string) =>
    request<{ agentId: string; url: string; createdAt: number }>(
      "/api/create-agent",
      { method: "POST", body: JSON.stringify({ url }) },
    ),
  // trigger a new scan
  scan: (agentId: string) =>
    request<ScanRecord>("/api/scan", {
      method: "POST",
      body: JSON.stringify({ agentId }),
    }),
  // everything the dashboard needs on load
  snapshot: (agentId: string) =>
    request<AgentSnapshot>(`/api/snapshot?id=${encodeURIComponent(agentId)}`),
  // full history, newest first
  history: (agentId: string) =>
    request<ScanRecord[]>(`/api/history?id=${encodeURIComponent(agentId)}`),
  // chat transcript for hydration on page load
  messages: (agentId: string) =>
    request<ChatMessage[]>(`/api/messages?id=${encodeURIComponent(agentId)}`),
  // send one chat message, get a reply + updated history
  chat: (agentId: string, message: string) =>
    request<{ reply: string; history: ChatMessage[] }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ agentId, message }),
    }),
};
