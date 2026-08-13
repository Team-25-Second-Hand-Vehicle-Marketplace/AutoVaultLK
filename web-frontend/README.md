# AutoVault LK — web frontend

React + Vite + Tailwind app for the marketplace. This pass covers the landing page and authentication for buyers, dealers, and administrators.

## Run locally

From the repo root, start Postgres + the nginx gateway, then auth-user-service. In this folder:

```bash
npm install
npm run dev
```

The Vite dev server (http://localhost:5173) proxies `/auth`, `/marketplace`, `/admin`, `/ingest`, and `/jobs` to `http://localhost:8080` so refresh cookies stay same-origin.

## Routes

| Path | Who |
|---|---|
| `/` | Public landing |
| `/auth/login` | Buyer / dealer login (`?role=dealer`) |
| `/auth/login/admin` | Administrator login |
| `/auth/register/buyer` | Buyer registration |
| `/auth/register/dealer` | Dealer registration (pending admin approval) |
| `/auth/verify-email` | Email verification + resend |
| `/auth/forgot-password` | Password reset request |
| `/auth/reset-password` | Password reset confirm |
| `/buyer` | Buyer dashboard (JWT, role BUYER) |
| `/dealer` | Dealer dashboard (JWT, role DEALER) |
| `/admin` | Admin dashboard (JWT, role ADMIN) |
