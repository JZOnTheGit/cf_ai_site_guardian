// the SiteAgent durable object
// one instance per monitored site, persists everything we know about that site
// stores: site metadata, every scan, and the chat transcript

import { DurableObject } from "cloudflare:workers";
import { runScan, isValidUrl, type ScanRaw } from "./analyzer";
import {
  generateScanInsight,
  generateCompareInsight,
  runChatStream,
  decideChatAction,
  type ScanInsight,
  type CompareInsight,
  type ChatMessage,
  type ChatToolCall,
} from "./ai";

// one row in the scan history
export interface ScanRecord {
  id: string;
  at: number;
  raw: ScanRaw;
  insight: ScanInsight;
  compare: CompareInsight | null;
}

// tiny meta record stored once per agent
interface AgentMeta {
  url: string;
  createdAt: number;
}

// per-agent settings, including the auto-scan schedule
export interface AgentSettings {
  // null means auto-scan is off
  autoScanIntervalHours: number | null;
  // timestamp of the next scheduled auto-scan, for display in the ui
  nextScanAt: number | null;
}

// shape returned by /snapshot for the dashboard
export interface AgentSnapshot {
  meta: AgentMeta | null;
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

// default settings used when a brand new agent is created
const DEFAULT_SETTINGS: AgentSettings = {
  autoScanIntervalHours: null,
  nextScanAt: null,
};

// hard cap on chat transcript rows, to keep DO storage small
const MAX_MESSAGES = 200;
// hard cap on scans kept in sqlite per agent
const MAX_SCANS = 100;

// the durable object class itself
export class SiteAgent extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // create tables on first boot, safe to run on every start
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scans (
          id TEXT PRIMARY KEY,
          at INTEGER NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          at INTEGER NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL
        );
      `);
    });
  }

  // ------------- http surface used by the worker -------------

  // tiny router so the worker can call us via stub.fetch()
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case "/init":
          return json(await this.init(await request.json<{ url: string }>()));
        case "/scan":
          return json(await this.scan());
        case "/snapshot":
          return json(await this.snapshot());
        case "/history":
          return json(await this.history());
        case "/chat":
          return this.chatStream(await request.json<{ message: string }>());
        case "/messages":
          return json(await this.messages());
        case "/settings":
          return json(
            await this.updateSettings(await request.json<Partial<AgentSettings>>()),
          );
        case "/clear-chat":
          return json(await this.clearChat());
        case "/destroy":
          return json(await this.destroy());
        case "/export":
          return json(await this.exportAll());
        default:
          return new Response("not found", { status: 404 });
      }
    } catch (err: any) {
      return json({ error: err?.message ?? "agent error" }, 500);
    }
  }

  // ------------- business logic -------------

  // first time setup for an agent, stores the url
  async init({ url }: { url: string }): Promise<AgentMeta> {
    if (!isValidUrl(url)) throw new Error("invalid url");
    // if we already exist, return the existing meta so calls are idempotent
    const existing = this.getMeta();
    if (existing) return existing;
    const meta: AgentMeta = {
      url: normalize(url),
      createdAt: Date.now(),
    };
    this.setMeta(meta);
    return meta;
  }

  // runs one scan + ai insight + compare-to-previous, saves the result
  async scan(): Promise<ScanRecord> {
    const meta = this.getMeta();
    if (!meta) throw new Error("agent not initialized");

    // hit the site and analyze it
    const raw = await runScan(meta.url);
    // ask the llm to interpret what we found
    const insight = await generateScanInsight(this.env.AI, raw);

    // compare to the last stored scan if there is one
    const prev = this.latestScan();
    const compare = prev
      ? await generateCompareInsight(
          this.env.AI,
          { raw: prev.raw, insight: prev.insight },
          { raw, insight },
        )
      : null;

    // build the record and save it to sqlite
    const record: ScanRecord = {
      id: crypto.randomUUID(),
      at: Date.now(),
      raw,
      insight,
      compare,
    };

    this.ctx.storage.sql.exec(
      `INSERT INTO scans (id, at, payload) VALUES (?, ?, ?)`,
      record.id,
      record.at,
      JSON.stringify(record),
    );

    // keep storage bounded: drop very old scans
    this.trimScans();

    return record;
  }

  // what the dashboard needs on page load in one call
  async snapshot(): Promise<AgentSnapshot> {
    return {
      meta: this.getMeta(),
      latest: this.latestScan(),
      settings: this.getSettings(),
      history: this.historySummary(),
    };
  }

  // update the auto-scan settings and reschedule the next alarm
  async updateSettings(patch: Partial<AgentSettings>): Promise<AgentSettings> {
    const current = this.getSettings();
    const next: AgentSettings = {
      autoScanIntervalHours:
        patch.autoScanIntervalHours === undefined
          ? current.autoScanIntervalHours
          : patch.autoScanIntervalHours,
      nextScanAt: current.nextScanAt,
    };

    // cancel any existing alarm, we will re-create one if auto-scan is still on
    await this.ctx.storage.deleteAlarm();

    if (next.autoScanIntervalHours && next.autoScanIntervalHours > 0) {
      // schedule the next scan N hours from now
      const nextAt = Date.now() + next.autoScanIntervalHours * 60 * 60 * 1000;
      await this.ctx.storage.setAlarm(nextAt);
      next.nextScanAt = nextAt;
    } else {
      // auto-scan is off, no next time
      next.nextScanAt = null;
    }

    this.setSettings(next);
    return next;
  }

  // fires when the durable object's alarm goes off
  // this is how the agent runs autonomously without any open browser tab
  override async alarm(): Promise<void> {
    const settings = this.getSettings();
    // guard against stale alarms if the user turned auto-scan off
    if (!settings.autoScanIntervalHours) return;

    // run a fresh scan (insight + compare + save to sqlite)
    try {
      await this.scan();
    } catch (err) {
      console.error("alarm scan failed", err);
    }

    // reschedule the next alarm so monitoring is continuous
    const nextAt = Date.now() + settings.autoScanIntervalHours * 60 * 60 * 1000;
    await this.ctx.storage.setAlarm(nextAt);
    this.setSettings({ ...settings, nextScanAt: nextAt });
  }

  // full history, newest first, capped at 50
  async history(): Promise<ScanRecord[]> {
    const rows = this.ctx.storage.sql
      .exec<{ payload: string }>(`SELECT payload FROM scans ORDER BY at DESC LIMIT 50`)
      .toArray();
    return rows.map((r) => JSON.parse(r.payload) as ScanRecord);
  }

  // wipe just the chat transcript, leaves scans + settings intact
  async clearChat(): Promise<{ ok: true }> {
    this.ctx.storage.sql.exec(`DELETE FROM messages`);
    return { ok: true };
  }

  // blow away every byte of state for this agent
  // caller is expected to tell the user this is permanent
  async destroy(): Promise<{ ok: true }> {
    // cancel any pending alarm first
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // no alarm to clear, ignore
    }
    // deleteAll drops all sqlite tables + key/value state
    await this.ctx.storage.deleteAll();
    return { ok: true };
  }

  // dump everything we know about this agent, used for download
  async exportAll(): Promise<{
    meta: AgentMeta | null;
    settings: AgentSettings;
    history: ScanRecord[];
    messages: ChatMessage[];
    exportedAt: number;
  }> {
    return {
      meta: this.getMeta(),
      settings: this.getSettings(),
      history: await this.history(),
      messages: this.loadMessages(),
      exportedAt: Date.now(),
    };
  }

  // run one chat turn as a streaming response
  // tokens are piped to the client live, and the final reply is saved to sqlite
  //
  // flow:
  //   1. save the user message
  //   2. ask the model to either answer directly or call a tool (non-streaming)
  //   3. if it wanted a tool: run it, then stream a final answer with the result
  //   4. if it just wants to answer: stream the answer
  async chatStream({ message }: { message: string }): Promise<Response> {
    const meta = this.getMeta();
    if (!meta) {
      return new Response(JSON.stringify({ error: "agent not initialized" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    const text = (message ?? "").toString().trim();
    if (!text) {
      return new Response(JSON.stringify({ error: "empty message" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    // save the user message immediately so it shows up in memory right away
    this.saveMessage({ role: "user", content: text });
    this.trimMessages();

    // load prior turns (now includes the just-saved user message)
    const prior = this.loadMessages().slice(0, -1);

    // decide: direct answer or tool call?
    const context = this.buildContext(meta);
    let toolResult: unknown = null;
    let toolName: string | null = null;
    try {
      const decision = await decideChatAction(this.env.AI, context, prior, text);
      if (decision) {
        toolName = decision.tool;
        toolResult = await this.runTool(decision);
      }
    } catch (err) {
      console.error("tool decision failed", err);
    }

    // build the final streaming call. If a tool ran, fold its result into context
    // so the model can phrase a short reply grounded in real data
    const finalContext = toolResult
      ? `${context}\n\nTool "${toolName}" returned:\n${JSON.stringify(toolResult, null, 2)}`
      : context;

    // ask workers ai for a streaming completion
    const upstream = await runChatStream(this.env.AI, finalContext, prior, text);

    // split the stream: one side goes to the client, the other we drain here
    // to rebuild the full assistant reply so we can persist it to sqlite.
    // waitUntil keeps the durable object alive until the save completes.
    const [forClient, forSave] = upstream.tee();

    this.ctx.waitUntil(
      (async () => {
        // buffer across chunks so we never lose a partial SSE line
        const reader = forSave.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assembled = "";
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // SSE frames are newline-delimited, keep the last partial line
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const tok = extractToken(line);
              if (tok) assembled += tok;
            }
          }
          // flush any trailing bytes and the final partial line
          buffer += decoder.decode();
          if (buffer) {
            const tok = extractToken(buffer);
            if (tok) assembled += tok;
          }
        } catch (err) {
          console.error("chat save reader failed", err);
        }
        // persist the assembled reply. If the model truly returned nothing,
        // save a clearly marked fallback so the transcript is still coherent.
        const final = assembled.trim() || "(model returned no text)";
        this.saveMessage({ role: "assistant", content: final });
        this.trimMessages();
      })(),
    );

    // return the other branch of the stream to the caller untouched
    // also echo the tool name in a header so the UI can label the turn
    return new Response(forClient, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        ...(toolName ? { "x-tool": toolName } : {}),
      },
    });
  }

  // dispatch a tool call onto one of the real methods
  // returns whatever structured data the tool produced
  private async runTool(call: ChatToolCall): Promise<unknown> {
    switch (call.tool) {
      case "get_latest_scan":
        return this.latestScan();
      case "list_history": {
        const raw = Number((call.args as any)?.limit ?? 10);
        const n = Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 1), 20) : 10;
        return this.historySummary().slice(0, n);
      }
      case "compare_scans": {
        const fromId = String((call.args as any)?.fromId ?? "");
        const toId = String((call.args as any)?.toId ?? "");
        return this.lookupCompare(fromId, toId);
      }
      case "request_new_scan":
        return this.scan();
      default:
        return null;
    }
  }

  // just the chat transcript, used when the chat panel first loads
  async messages(): Promise<ChatMessage[]> {
    return this.loadMessages();
  }

  // builds the JSON context string the llm uses as "memory" for this site
  private buildContext(meta: AgentMeta): string {
    return JSON.stringify(
      {
        site: meta,
        latest: this.latestScan(),
        history: this.historySummary(),
      },
      null,
      2,
    );
  }

  // ------------- storage helpers -------------

  // read the single meta row
  private getMeta(): AgentMeta | null {
    const row = this.ctx.storage.sql
      .exec<{ v: string }>(`SELECT v FROM meta WHERE k = 'meta'`)
      .toArray()[0];
    return row ? (JSON.parse(row.v) as AgentMeta) : null;
  }

  // upsert the meta row
  private setMeta(meta: AgentMeta) {
    this.ctx.storage.sql.exec(
      `INSERT INTO meta (k, v) VALUES ('meta', ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(meta),
    );
  }

  // read the settings row, falling back to defaults on first run
  private getSettings(): AgentSettings {
    const row = this.ctx.storage.sql
      .exec<{ v: string }>(`SELECT v FROM meta WHERE k = 'settings'`)
      .toArray()[0];
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(row.v) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  // upsert the settings row
  private setSettings(settings: AgentSettings) {
    this.ctx.storage.sql.exec(
      `INSERT INTO meta (k, v) VALUES ('settings', ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(settings),
    );
  }

  // newest scan record or null if none yet
  private latestScan(): ScanRecord | null {
    const row = this.ctx.storage.sql
      .exec<{ payload: string }>(
        `SELECT payload FROM scans ORDER BY at DESC LIMIT 1`,
      )
      .toArray()[0];
    return row ? (JSON.parse(row.payload) as ScanRecord) : null;
  }

  // look up two scan records by id and compute a fresh compare, used by tool
  private lookupCompare(fromId: string, toId: string): unknown {
    const fetchOne = (id: string) => {
      const row = this.ctx.storage.sql
        .exec<{ payload: string }>(`SELECT payload FROM scans WHERE id = ?`, id)
        .toArray()[0];
      return row ? (JSON.parse(row.payload) as ScanRecord) : null;
    };
    const a = fetchOne(fromId);
    const b = fetchOne(toId);
    if (!a || !b) return { error: "one or both scan ids not found" };
    // fresh deterministic compare, cheap, no llm
    return {
      fromId,
      toId,
      previous: {
        at: a.at,
        scores: a.insight.scores,
        missing: a.raw.security.missingCount,
        ttfb: a.raw.performance.ttfbMs,
      },
      current: {
        at: b.at,
        scores: b.insight.scores,
        missing: b.raw.security.missingCount,
        ttfb: b.raw.performance.ttfbMs,
      },
    };
  }

  // small summary rows for the timeline on the dashboard
  private historySummary(): AgentSnapshot["history"] {
    const rows = this.ctx.storage.sql
      .exec<{ id: string; at: number; payload: string }>(
        `SELECT id, at, payload FROM scans ORDER BY at DESC LIMIT 20`,
      )
      .toArray();
    return rows.map((r) => {
      const rec = JSON.parse(r.payload) as ScanRecord;
      return {
        id: r.id,
        at: r.at,
        scores: rec.insight.scores,
        status: rec.raw.status,
        ok: rec.raw.ok,
      };
    });
  }

  // load chat history in order
  private loadMessages(): ChatMessage[] {
    const rows = this.ctx.storage.sql
      .exec<{ role: string; content: string }>(
        `SELECT role, content FROM messages ORDER BY at ASC LIMIT 100`,
      )
      .toArray();
    return rows.map((r) => ({
      role: r.role as ChatMessage["role"],
      content: r.content,
    }));
  }

  // append one chat message
  private saveMessage(msg: ChatMessage) {
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (id, at, role, content) VALUES (?, ?, ?, ?)`,
      crypto.randomUUID(),
      Date.now(),
      msg.role,
      msg.content,
    );
  }

  // drop the oldest chat rows past the cap so DO storage stays small
  private trimMessages() {
    this.ctx.storage.sql.exec(
      `DELETE FROM messages WHERE id IN (
         SELECT id FROM messages ORDER BY at DESC LIMIT -1 OFFSET ?
       )`,
      MAX_MESSAGES,
    );
  }

  // drop the oldest scan rows past the cap
  private trimScans() {
    this.ctx.storage.sql.exec(
      `DELETE FROM scans WHERE id IN (
         SELECT id FROM scans ORDER BY at DESC LIMIT -1 OFFSET ?
       )`,
      MAX_SCANS,
    );
  }
}

// add https:// if missing
function normalize(raw: string): string {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// parse one SSE line from workers ai and return the token text (if any)
// lines look like: data: {"response":"tok","p":"...","usage":...}
function extractToken(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const obj = JSON.parse(payload);
    return typeof obj.response === "string" ? obj.response : null;
  } catch {
    return null;
  }
}

// tiny helper to return json responses from the DO
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
