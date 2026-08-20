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
    // Each entry mirrors the matching `location` block in nginx.conf so that
    // request paths are identical in dev and production.
    proxy: {
      // nginx: location /marketplace/ -> marketplace_service/ (prefix stripped)
      "/marketplace": {
        target: "http://localhost:3002",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/marketplace/, ""),
      },
      // nginx: location /auth/ -> auth_user_service/auth/ (prefix PRESERVED —
      // the service mounts its own @Controller('auth'), unlike marketplace).
      "/auth": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // nginx: location /users/ -> auth_user_service/users/
      "/users": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // nginx: location /admin/ -> admin_service/admin/ (prefix PRESERVED)
      //
      // The SPA also owns /admin/* routes (/admin/login, /admin/users, ...),
      // so a bare prefix match would send browser navigations to the API and
      // return its 404 JSON instead of rendering React. In production nginx
      // serves the SPA and the API separately and never has this ambiguity.
      //
      // Only proxy requests that are actual API calls: XHR/fetch send
      // Accept: application/json, while a navigation sends Accept: text/html.
      "/admin": {
        target: "http://localhost:3004",
        changeOrigin: true,
        bypass(req) {
          const accept = req.headers.accept ?? "";
          // Returning the path tells vite to serve it locally (SPA fallback)
          // rather than proxying; returning undefined proxies as normal.
          if (accept.includes("text/html")) return "/index.html";
          return undefined;
        },
      },
    },
  },
});