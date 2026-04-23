// flat-config eslint for the worker + react app
// we intentionally keep rules minimal: fix real bugs, stay out of the way
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  // skip generated + build output
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "worker-configuration.d.ts",
      ".wrangler/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        // cloudflare runtime globals we use from worker code
        Request: "readonly",
        Response: "readonly",
        Headers: "readonly",
        URL: "readonly",
        fetch: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        crypto: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        AbortController: "readonly",
        // browser-only globals used in src/
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        confirm: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLDivElement: "readonly",
        KeyboardEvent: "readonly",
        React: "readonly",
      },
    },
    rules: {
      // allow the `any` escape hatch in a few ai-response places
      "@typescript-eslint/no-explicit-any": "off",
      // unused vars allowed if they start with _
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // cloudflare types sometimes need empty interface merges
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
];
