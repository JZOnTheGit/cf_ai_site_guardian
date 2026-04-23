// main worker entrypoint, handles all /api/* routes
// anything else falls through to the static assets binding (the built spa)
//
// routes:
//   POST /api/create-agent  { url }                       -> { agentId, url }
//   POST /api/scan          { agentId }                   -> ScanRecord
//   GET  /api/snapshot?id=                                -> AgentSnapshot
//   GET  /api/history?id=                                 -> ScanRecord[]
//   GET  /api/messages?id=                                -> ChatMessage[]
//   POST /api/chat          { agentId, message }          -> text/event-stream
//   POST /api/settings      { agentId, autoScanIntervalHours } -> AgentSettings
//   POST /api/clear-chat    { agentId }                   -> { ok: true }
//   POST /api/delete-agent  { agentId }                   -> { ok: true }
//   GET  /api/export?id=                                  -> application/json download

import { SiteAgent } from "./agent";
import { isValidUrl } from "./analyzer";
import {
  HttpError,
  assertOptionalNumber,
  assertString,
  isSameOrigin,
  isValidAgentId,
  rateLimit,
} from "./security";

// re-export so wrangler can find the durable object class
export { SiteAgent };

// deterministic DO id from the url, so same url always hits the same agent
function agentIdFromUrl(env: Env, url: string): DurableObjectId {
  const normalized = url.trim().toLowerCase().replace(/\/+$/, "");
  return env.SITE_AGENT.idFromName(normalized);
}

// helper to call any path on a DO by its id string
async function callAgent(
  env: Env,
  idStr: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (!isValidAgentId(idStr)) {
    throw new HttpError(400, "invalid agentId");
  }
  const id = env.SITE_AGENT.idFromString(idStr);
  const stub = env.SITE_AGENT.get(id);
  return stub.fetch("https://agent.internal" + path, init);
}

// json response helper
function j(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  // main request handler
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // not an api call, let the static assets binding handle it
    // we also add long-lived cache headers for hashed vite assets
    if (!url.pathname.startsWith("/api/")) {
      const res = await env.ASSETS.fetch(request);
      return withAssetCaching(request, res);
    }

    try {
      // csrf-ish defense: only allow mutations from the same origin
      if (!isSameOrigin(request)) {
        throw new HttpError(403, "cross-origin request rejected");
      }

      // create or fetch an agent for a url
      if (url.pathname === "/api/create-agent" && request.method === "POST") {
        // throttle: 10 new agents per minute per ip
        rateLimit(request, "create-agent", 10);
        const body = await request.json<{ url?: string }>();
        const siteUrl = assertString(body.url, "url", 2048);
        if (!isValidUrl(siteUrl)) {
          return j({ error: "Please provide a valid URL." }, 400);
        }
        const id = agentIdFromUrl(env, siteUrl);
        const stub = env.SITE_AGENT.get(id);
        // tell the DO to set itself up
        const res = await stub.fetch("https://agent.internal/init", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: siteUrl }),
        });
        if (!res.ok) return forward(res);
        const meta = await res.json();
        return j({ agentId: id.toString(), ...(meta as object) });
      }

      // run a new scan on an existing agent
      if (url.pathname === "/api/scan" && request.method === "POST") {
        // throttle: 30 scans per minute per ip across all agents
        rateLimit(request, "scan", 30);
        const { agentId } = await request.json<{ agentId?: string }>();
        if (!isValidAgentId(agentId)) return j({ error: "invalid agentId" }, 400);
        const res = await callAgent(env, agentId, "/scan", { method: "POST" });
        return forward(res);
      }

      // snapshot for the dashboard
      if (url.pathname === "/api/snapshot" && request.method === "GET") {
        const id = url.searchParams.get("id");
        if (!isValidAgentId(id)) return j({ error: "invalid agentId" }, 400);
        const res = await callAgent(env, id, "/snapshot");
        return forward(res);
      }

      // full scan history
      if (url.pathname === "/api/history" && request.method === "GET") {
        const id = url.searchParams.get("id");
        if (!isValidAgentId(id)) return j({ error: "invalid agentId" }, 400);
        const res = await callAgent(env, id, "/history");
        return forward(res);
      }

      // chat transcript, read-only
      if (url.pathname === "/api/messages" && request.method === "GET") {
        const id = url.searchParams.get("id");
        if (!isValidAgentId(id)) return j({ error: "invalid agentId" }, 400);
        const res = await callAgent(env, id, "/messages");
        return forward(res);
      }

      // send one chat message and get a streaming reply back
      if (url.pathname === "/api/chat" && request.method === "POST") {
        // throttle: 60 messages per minute per ip
        rateLimit(request, "chat", 60);
        const body = await request.json<{ agentId?: string; message?: string }>();
        if (!isValidAgentId(body.agentId)) {
          return j({ error: "invalid agentId" }, 400);
        }
        const message = assertString(body.message, "message", 2000);
        const res = await callAgent(env, body.agentId, "/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message }),
        });
        // pass the DO's stream response straight through to the client
        return new Response(res.body, {
          status: res.status,
          headers: {
            "content-type":
              res.headers.get("content-type") ?? "text/event-stream",
            "cache-control": "no-cache, no-transform",
            ...(res.headers.get("x-tool")
              ? { "x-tool": res.headers.get("x-tool")! }
              : {}),
          },
        });
      }

      // update auto-scan settings for an agent
      if (url.pathname === "/api/settings" && request.method === "POST") {
        const body = await request.json<{
          agentId?: string;
          autoScanIntervalHours?: number | null;
        }>();
        if (!isValidAgentId(body.agentId)) {
          return j({ error: "invalid agentId" }, 400);
        }
        // allowed values: null (off) or a small integer number of hours
        const hours = assertOptionalNumber(
          body.autoScanIntervalHours,
          "autoScanIntervalHours",
          0,
          24 * 7,
        );
        const res = await callAgent(env, body.agentId, "/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ autoScanIntervalHours: hours }),
        });
        return forward(res);
      }

      // wipe the chat transcript for an agent
      if (url.pathname === "/api/clear-chat" && request.method === "POST") {
        const { agentId } = await request.json<{ agentId?: string }>();
        if (!isValidAgentId(agentId)) return j({ error: "invalid agentId" }, 400);
        const res = await callAgent(env, agentId, "/clear-chat", { method: "POST" });
        return forward(res);
      }

      // destroy an agent completely (DO storage wipe)
      if (url.pathname === "/api/delete-agent" && request.method === "POST") {
        const { agentId } = await request.json<{ agentId?: string }>();
        if (!isValidAgentId(agentId)) return j({ error: "invalid agentId" }, 400);
        const res = await callAgent(env, agentId, "/destroy", { method: "POST" });
        return forward(res);
      }

      // download a json dump of the agent's state
      if (url.pathname === "/api/export" && request.method === "GET") {
        const id = url.searchParams.get("id");
        if (!isValidAgentId(id)) return j({ error: "invalid agentId" }, 400);
        const res = await callAgent(env, id, "/export");
        const text = await res.text();
        return new Response(text, {
          status: res.status,
          headers: {
            "content-type": "application/json",
            // tell the browser to download this as a file
            "content-disposition": `attachment; filename="site-guardian-${id.slice(0, 8)}.json"`,
          },
        });
      }

      // unknown api path
      return j({ error: "not found" }, 404);
    } catch (err: any) {
      // clean status codes on expected errors, 500 otherwise
      if (err instanceof HttpError) {
        return j({ error: err.message }, err.status);
      }
      return j({ error: err?.message ?? "internal error" }, 500);
    }
  },

  // cron trigger handler
  // cloudflare calls this on the schedule we declared in wrangler.toml
  // we use it as a belt-and-suspenders backup to DO alarms: it is a no-op
  // unless something ever needs global sweeping, but the entrypoint is
  // already wired up so you can extend it later.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log(
      JSON.stringify({ evt: "cron.tick", cron: controller.cron, at: Date.now() }),
    );
    // keep the placeholder so dev has the env + ctx in scope
    void env;
    void ctx;
  },
} satisfies ExportedHandler<Env>;

// pass through a response from the DO to the client untouched
async function forward(res: Response): Promise<Response> {
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

// add long-lived cache headers to hashed vite assets so repeat visits
// feel instant on the edge. html is left short-cache so deploys propagate.
function withAssetCaching(request: Request, res: Response): Response {
  const url = new URL(request.url);
  // vite emits hashed asset filenames into /assets
  if (url.pathname.startsWith("/assets/")) {
    const headers = new Headers(res.headers);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    return new Response(res.body, { status: res.status, headers });
  }
  // html: allow short edge cache and always revalidate
  if (
    url.pathname === "/" ||
    url.pathname.endsWith(".html") ||
    !url.pathname.includes(".")
  ) {
    const headers = new Headers(res.headers);
    headers.set("cache-control", "public, max-age=0, must-revalidate");
    // preload hint for the main js bundle so browsers fetch it earlier
    const link = headers.get("link");
    const hint = '</assets/index.js>; rel=preload; as=script';
    if (!link) headers.set("link", hint);
    return new Response(res.body, { status: res.status, headers });
  }
  return res;
}
