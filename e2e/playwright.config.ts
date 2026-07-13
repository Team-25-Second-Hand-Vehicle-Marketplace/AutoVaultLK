import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

// The repo-root .env carries ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD, used by
// helpers/admin-api.ts to approve a dealer via a direct API call in the
// dealer-registration journey - the same credentials that seeded the local
// admin user via database/src/seeds/admin-user.seed.ts.
loadEnv({ path: '../.env' });

const baseURL = process.env.BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  // Auth-heavy journeys (registration, login, resend) all originate from the
  // same loopback IP under a local/CI run, and auth-user-service's
  // AuthAbuseProtectionService rate-limits by IP - a real safeguard, not a
  // bug. Running fully parallel intermittently trips it when several
  // journeys' auth calls land in the same window (observed under Firefox at
  // 2 workers), so this suite runs serially rather than treating that as
  // acceptable flakiness to retry away.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
