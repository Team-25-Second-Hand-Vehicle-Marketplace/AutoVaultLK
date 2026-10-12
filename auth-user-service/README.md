# Auth and User Service

Owns accounts, sign-in, tokens, dealer profiles and dealer verification for AutoVault LK. Runs on port **3001**.

## Responsibilities

- Buyer and dealer registration, e-mail verification and resend.
- Sign-in with e-mail and password, Google sign-in and administrator sign-in.
- Access tokens (JWT) and refresh tokens, with logout and logout from all sessions.
- Password change and password reset by e-mail.
- Dealer profiles, verification documents, and dealer approval or rejection.
- Internal routes used by the Admin service.

## Routes

| Area | Routes |
|---|---|
| Auth (`/auth`) | `POST register/buyer`, `POST register/dealer`, `POST login`, `POST login/admin`, `POST google`, `POST refresh`, `POST logout`, `POST logout/all`, `POST password-reset/request`, `POST forgot-password`, `POST password-reset/confirm`, `POST password/change`, `POST email/verify`, `POST email/resend-verification` |
| Users (`/users`) | `GET me`, `GET /`, `GET :id`, `POST /`, `PATCH :id`, `PATCH :id/account` |
| Dealer profiles (`/dealer-profiles`) | `GET me`, `GET /`, `GET :userId`, `POST /`, `PATCH :userId`, `PATCH :userId/resubmit` |
| Documents (`/documents`) | `POST verification` (upload a verification document), `GET local/*key` (local development only) |
| Internal users (`/internal/users`) | `POST :id/deactivate`, `POST :id/reactivate`, `POST admin` |
| Internal dealers (`/internal/dealers`) | `POST :id/approve`, `POST :id/reject` |
| Health (`/health`) | Liveness check |

The `/internal/*` routes are guarded by the `X-Internal-Service-Key` header.

## Configuration

Copy `.env.example` to `.env` and fill in the values. The file lists every variable with a safe default.

| Group | Variables |
|---|---|
| Service | `PORT`, `AUTH_DATABASE_URL`, `DATABASE_SSL`, `NODE_ENV`, `CORS_ORIGINS`, `COOKIE_SECURE`, `HTTP_JSON_BODY_LIMIT`, `DISABLE_VERBOSE_ERRORS`, `FRONTEND_URL` |
| Tokens | `JWT_ALGORITHM`, `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `AUTH_USE_REFRESH_COOKIES`, `AUTH_REFRESH_TOKEN_IN_BODY` |
| Sign-in limits | `AUTH_LOGIN_MAX_ATTEMPTS`, `AUTH_LOGIN_LOCKOUT_MINUTES`, `AUTH_LOGIN_WINDOW_MINUTES`, `AUTH_REGISTER_MAX_PER_IP`, `AUTH_REGISTER_WINDOW_MINUTES`, `AUTH_REFRESH_MAX_PER_IP`, `AUTH_REFRESH_WINDOW_MINUTES` |
| Passwords | `AUTH_PASSWORD_RESET_MAX_PER_EMAIL`, `PASSWORD_HISTORY_COUNT` |
| Google | `GOOGLE_CLIENT_ID` |
| E-mail | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SES_FROM_EMAIL`, `SES_TIMEOUT_MS`, `AWS_REGION` |
| Verification documents | `DOCUMENT_SERVE_MODE`, `VERIFICATION_DOCS_BUCKET`, `VERIFICATION_DOCS_LOCAL_ROOT`, `DOCUMENT_PRESIGN_EXPIRY_SECONDS` |
| Internal | `INTERNAL_SERVICE_KEY` |

Keep `SMTP_PASS` and the other secrets in the git-ignored `.env`. Never commit them.

## Scripts

```bash
npm run start:dev         # run with watch mode
npm run build             # compile to dist/
npm run test:ci           # unit tests
npm run test:integration  # needs the local PostgreSQL container
npm run test:contract
npm run test:e2e
npm run test:security     # authentication journeys
```

Start the local database with `docker compose up -d` at the repository root before running the integration or end-to-end suites.

## Structure

```text
src/
├── modules/
│   ├── auth/        sign-in, tokens, e-mail verification and password reset
│   ├── users/       user accounts and internal user routes
│   ├── dealers/     dealer profiles, verification and internal dealer routes
│   └── documents/   verification document upload and serving
├── common/          guards, security helpers and exception filters
├── config/          database, HTTP security and document serving configuration
└── health/          liveness check
```
