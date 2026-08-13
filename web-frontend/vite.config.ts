import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/auth": { target: "http://localhost:8080", changeOrigin: true },
      "/marketplace": { target: "http://localhost:8080", changeOrigin: true },
      "/admin": { target: "http://localhost:8080", changeOrigin: true },
      "/ingest": { target: "http://localhost:8080", changeOrigin: true },
      "/jobs": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
