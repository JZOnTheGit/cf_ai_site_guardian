// vitest config
// we run pure-function tests against the worker code without spinning up
// miniflare, which keeps CI fast and the test dependencies minimal
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // test files can live next to source or in ./test
    include: ["test/**/*.test.ts", "worker/**/*.test.ts"],
    // run in a node env since these are pure ts utilities
    environment: "node",
    globals: false,
  },
});
