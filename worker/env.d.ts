// types for the bindings declared in wrangler.toml
interface Env {
  // workers ai binding, used to call the llama model
  AI: Ai;
  // static assets binding, serves the built react app
  ASSETS: Fetcher;
  // durable object namespace for the per-site agents
  SITE_AGENT: DurableObjectNamespace<import("./agent").SiteAgent>;
}
