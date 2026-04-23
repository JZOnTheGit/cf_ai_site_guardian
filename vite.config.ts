// vite config for the react frontend
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // enable react fast refresh + jsx
  plugins: [react()],
  server: {
    port: 5173,
    // proxy api calls to the local worker during dev
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  // build output goes into ./dist which the worker serves as static assets
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
