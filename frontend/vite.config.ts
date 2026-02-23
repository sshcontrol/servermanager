import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
    // HMR WebSocket must match the page: HTTPS → wss://, HTTP → ws:// (mixed content is blocked)
    // For https://sshcontrol.com set VITE_HMR_HOST=sshcontrol.com and VITE_HMR_SECURE=true
    hmr: (() => {
      const host = process.env.VITE_HMR_HOST;
      const secure = process.env.VITE_HMR_SECURE === "true" || process.env.VITE_HMR_SECURE === "1";
      if (!host) return true;
      if (secure) {
        return { host, port: parseInt(process.env.VITE_HMR_PORT || "443", 10), protocol: "wss" as const };
      }
      return { host, port: 3000, protocol: "ws" as const };
    })(),
    proxy: {
      // /api is forwarded to the backend. Set PROXY_TARGET for your setup:
      // - Docker: PROXY_TARGET=http://backend:8000 (set in docker-compose)
      // - Local dev (frontend + backend on same machine): PROXY_TARGET=http://localhost:8000 or leave unset
      "/api": {
        target: process.env.PROXY_TARGET || "http://localhost:8000",
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on("error", (err) => {
            console.warn("[vite proxy] backend unreachable (is port 8000 running?):", (err as Error).message);
          });
        },
      },
    },
  },
});
