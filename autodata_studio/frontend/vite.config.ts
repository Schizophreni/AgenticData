import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Relative base so assets resolve correctly behind a path-prefixed reverse proxy
 * (e.g. the notebook proxy at .../proxy/5173/). API/SSE calls are resolved against
 * the current page URL at runtime — see src/lib/api.ts. An absolute base breaks
 * under the proxy prefix.
 *
 * The two vLLM models live on 127.0.0.1 inside THIS container, behind SSH tunnels.
 * The backend can reach them directly — role bindings therefore point straight at
 * http://127.0.0.1:800x/v1 and never come through here.
 *
 * The browser cannot: it runs on the user's machine, where 127.0.0.1 is their own
 * laptop. So anything the BROWSER calls (today: selection translation) is proxied
 * through this server, which does sit next to the tunnels. That also disposes of
 * CORS, since the request becomes same-origin.
 *
 * Ports drift when the tunnels are re-established — override without editing code:
 *   AUTODATA_LLM_TEXT=http://127.0.0.1:8002  AUTODATA_LLM_VISION=http://127.0.0.1:8004
 */
const LLM_TEXT = process.env.AUTODATA_LLM_TEXT || "http://127.0.0.1:8002";
const LLM_VISION = process.env.AUTODATA_LLM_VISION || "http://127.0.0.1:8004";
const LLM_CHALLENGER = process.env.AUTODATA_LLM_CHALLENGER || "http://127.0.0.1:8007";

const proxy = {
  "/api": { target: "http://localhost:8000", changeOrigin: true },
  "/llm/text": {
    target: LLM_TEXT,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/llm\/text/, ""),
  },
  "/llm/vision": {
    target: LLM_VISION,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/llm\/vision/, ""),
  },
  "/llm/challenger": {
    target: LLM_CHALLENGER,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/llm\/challenger/, ""),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: { port: 5173, host: true, allowedHosts: true, proxy },
  preview: { port: 5173, host: true, allowedHosts: true, proxy },
});
