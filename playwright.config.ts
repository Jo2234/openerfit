import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tests/e2e', workers:1, fullyParallel:false, retries:0, maxFailures:1,
  timeout:45000, expect:{timeout:10000},
  use:{baseURL:'http://127.0.0.1:5189',browserName:'chromium',viewport:{width:1280,height:900},screenshot:'only-on-failure',trace:'retain-on-failure'},
  // Run pnpm build first. Playwright owns and
  // terminates this one loopback fixture server; no reuse of someone else's port.
  webServer:{
    command:'NODE_ENV=production QLOO_MODE=fixture LLM_MODE=fixture HOST=127.0.0.1 PORT=5189 ./node_modules/.bin/tsx src/server/main.ts',
    url:'http://127.0.0.1:5189/api/health',reuseExistingServer:false,timeout:15000,
    gracefulShutdown:{signal:'SIGTERM',timeout:5000},
  },
});
