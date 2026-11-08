import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Injected at build time only: the dev server needs Vite's inline refresh preamble.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "omnibrain-csp",
      apply: "build",
      transformIndexHtml() {
        return [
          {
            tag: "meta",
            attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
            injectTo: "head-prepend",
          },
        ];
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
      "/mcp": { target: "http://localhost:8787", changeOrigin: false },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
