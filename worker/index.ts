// main worker entrypoint, handles all /api/* routes
// anything else falls through to the static assets binding (the built spa)
//
// routes:
//   POST /api/create-agent  { url }             -> { agentId, url }
//   POST /api/scan          { agentId }         -> ScanRecord
//   GET  /api/snapshot?id=                      -> AgentSnapshot
//   GET  /api/history?id=                       -> ScanRecord[]
//   GET  /api/messages?id=                      -> ChatMessage[]
//   POST /api/chat          { agentId, message }-> { reply, history }

import { SiteAgent } from "./agent";
import { isValidUrl } from "./analyzer";

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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // not an api call, let the static assets binding handle it
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      // create or fetch an agent for a url
      if (url.pathname === "/api/create-agent" && request.method === "POST") {
        const { url: siteUrl } = await request.json<{ url?: string }>();
        if (!siteUrl || !isValidUrl(siteUrl)) {
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
        const { agentId } = await request.json<{ agentId?: string }>();
        if (!agentId) return j({ error: "missing agentId" }, 400);
        const res = await callAgent(env, agentId, "/scan", { method: "POST" });
        return forward(res);
      }

      // snapshot for the dashboard
      if (url.pathname === "/api/snapshot" && request.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) return j({ error: "missing id" }, 400);
        const res = await callAgent(env, id, "/snapshot");
        return forward(res);
      }

      // full scan history
      if (url.pathname === "/api/history" && request.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) return j({ error: "missing id" }, 400);
        const res = await callAgent(env, id, "/history");
        return forward(res);
      }

      // chat transcript, read-only
      if (url.pathname === "/api/messages" && request.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) return j({ error: "missing id" }, 400);
        const res = await callAgent(env, id, "/messages");
        return forward(res);
      }

      // send one chat message and get a reply
      if (url.pathname === "/api/chat" && request.method === "POST") {
        const { agentId, message } = await request.json<{
          agentId?: string;
          message?: string;
        }>();
        if (!agentId) return j({ error: "missing agentId" }, 400);
        if (!message?.trim()) return j({ error: "missing message" }, 400);
        const res = await callAgent(env, agentId, "/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message }),
        });
        return forward(res);
      }

      // unknown api path
      return j({ error: "not found" }, 404);
    } catch (err: any) {
      return j({ error: err?.message ?? "internal error" }, 500);
    }
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
