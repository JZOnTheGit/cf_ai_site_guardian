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

// one accessibility issue returned by the analyzer
export interface A11yIssue {
  id: string;
  severity: "high" | "medium" | "low";
  message: string;
}

// one broken internal link sampled on the home page
export interface LinkCheck {
  url: string;
  status: number;
  ok: boolean;
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
  accessibility: {
    score: number;
    issues: A11yIssue[];
    imagesMissingAlt: number;
    totalImages: number;
    headingOrderOk: boolean;
  };
  tls: {
    protocol: string | null;
    cipher: string | null;
    httpVersion: string | null;
    country: string | null;
    colo: string | null;
  };
  links: { sampled: number; broken: LinkCheck[] };
  error?: string;
}

// severity tag on an insight issue
export type Severity = "critical" | "high" | "medium" | "low";

// one issue line: human text + severity color
export interface InsightIssue {
  text: string;
  severity: Severity;
}

// what the llm (or fallback) produces for one scan
export interface ScanInsight {
  summary: string;
  issues: InsightIssue[];
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

// per-agent settings returned by /api/snapshot and /api/settings
export interface AgentSettings {
  autoScanIntervalHours: number | null;
  nextScanAt: number | null;
}

// the shape /api/snapshot returns
export interface AgentSnapshot {
  meta: { url: string; createdAt: number } | null;
  latest: ScanRecord | null;
  settings: AgentSettings;
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
async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  // stream a chat reply, calling onToken for every token received
  // resolves with the fully assembled reply + any tool used for this turn
  chatStream: async (
    agentId: string,
    message: string,
    onToken: (tok: string) => void,
  ): Promise<{ text: string; tool: string | null }> => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, message }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text();
      throw new Error(text || `request failed: ${res.status}`);
    }
    const tool = res.headers.get("x-tool");
    // read the SSE stream chunk by chunk
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assembled = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by blank lines, but workers ai uses \n
      const lines = buffer.split("\n");
      // keep the last (possibly incomplete) line for the next iteration
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload);
          if (typeof obj.response === "string") {
            assembled += obj.response;
            onToken(obj.response);
          }
        } catch {
          // ignore malformed frames
        }
      }
    }
    return { text: assembled, tool };
  },
  // update auto-scan settings
  updateSettings: (agentId: string, autoScanIntervalHours: number | null) =>
    request<AgentSettings>("/api/settings", {
      method: "POST",
      body: JSON.stringify({ agentId, autoScanIntervalHours }),
    }),
  // wipe the chat transcript
  clearChat: (agentId: string) =>
    request<{ ok: true }>("/api/clear-chat", {
      method: "POST",
      body: JSON.stringify({ agentId }),
    }),
  // destroy the agent and everything about it
  deleteAgent: (agentId: string) =>
    request<{ ok: true }>("/api/delete-agent", {
      method: "POST",
      body: JSON.stringify({ agentId }),
    }),
  // build the url the browser should hit to download an export file
  exportUrl: (agentId: string) =>
    `/api/export?id=${encodeURIComponent(agentId)}`,
};
