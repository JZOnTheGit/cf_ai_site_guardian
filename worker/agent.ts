// the SiteAgent durable object
// one instance per monitored site, persists everything we know about that site
// stores: site metadata, every scan, and the chat transcript

import { DurableObject } from "cloudflare:workers";
import { runScan, isValidUrl, type ScanRaw } from "./analyzer";
import {
  generateScanInsight,
  generateCompareInsight,
  runChat,
  type ScanInsight,
  type CompareInsight,
  type ChatMessage,
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

// shape returned by /snapshot for the dashboard
export interface AgentSnapshot {
  meta: AgentMeta | null;
  latest: ScanRecord | null;
  history: Array<{
    id: string;
    at: number;
    scores: ScanInsight["scores"];
    status: number;
    ok: boolean;
  }>;
}

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
          return json(await this.chat(await request.json<{ message: string }>()));
        case "/messages":
          return json(await this.messages());
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

    return record;
  }

  // what the dashboard needs on page load in one call
  async snapshot(): Promise<AgentSnapshot> {
    return {
      meta: this.getMeta(),
      latest: this.latestScan(),
      history: this.historySummary(),
    };
  }

  // full history, newest first, capped at 50
  async history(): Promise<ScanRecord[]> {
    const rows = this.ctx.storage.sql
      .exec<{ payload: string }>(`SELECT payload FROM scans ORDER BY at DESC LIMIT 50`)
      .toArray();
    return rows.map((r) => JSON.parse(r.payload) as ScanRecord);
  }

  // run one chat turn and save both the question and answer
  async chat({ message }: { message: string }): Promise<{
    reply: string;
    history: ChatMessage[];
  }> {
    const meta = this.getMeta();
    if (!meta) throw new Error("agent not initialized");
    const text = (message ?? "").toString().trim();
    if (!text) throw new Error("empty message");

    // load prior turns so the llm has memory
    const prior = this.loadMessages();
    // build the fresh context the llm gets as a system message
    const context = JSON.stringify(
      {
        site: meta,
        latest: this.latestScan(),
        history: this.historySummary(),
      },
      null,
      2,
    );

    // call the model
    const reply = await runChat(this.env.AI, context, prior, text);

    // persist the user message and the assistant reply
    this.saveMessage({ role: "user", content: text });
    this.saveMessage({ role: "assistant", content: reply });

    return { reply, history: this.loadMessages() };
  }

  // just the chat transcript, used when the chat panel first loads
  async messages(): Promise<ChatMessage[]> {
    return this.loadMessages();
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

  // newest scan record or null if none yet
  private latestScan(): ScanRecord | null {
    const row = this.ctx.storage.sql
      .exec<{ payload: string }>(
        `SELECT payload FROM scans ORDER BY at DESC LIMIT 1`,
      )
      .toArray()[0];
    return row ? (JSON.parse(row.payload) as ScanRecord) : null;
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
}

// add https:// if missing
function normalize(raw: string): string {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// tiny helper to return json responses from the DO
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
