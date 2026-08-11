import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Dev-only proxy standing in for api-gateway/local/nginx.conf, so the
    // frontend works without the nginx container running and without CORS.
    // Mirrors nginx's `location /marketplace/` -> marketplace-service:3002
    // with the prefix stripped, so the browser and production paths match.
    proxy: {
      "/marketplace": {
        target: "http://localhost:3002",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/marketplace/, ""),
      },
    },
  },
});