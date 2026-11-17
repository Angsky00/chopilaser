import { defineConfig, devices } from '@playwright/test';

const PUERTO = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PUERTO}/`,
    acceptDownloads: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // Solo en Windows (CI windows-latest): Edge instalado en el sistema.
    { name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PUERTO} --strictPort`,
    url: `http://127.0.0.1:${PUERTO}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
