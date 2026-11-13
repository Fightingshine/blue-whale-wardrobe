import { defineConfig, devices } from '@playwright/test';

const port=Number(process.env.PW_PORT || 4173);
const baseURL=`http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL, screenshot: 'only-on-failure', trace: 'retain-on-failure', channel:process.env.PW_CHANNEL || undefined },
  projects: [
    { name:'desktop', use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1050}} },
    { name:'mobile', use:{...devices['Desktop Chrome'],viewport:{width:390,height:844},isMobile:true,hasTouch:true} },
  ],
  webServer: { command:`npm run dev -- --port ${port} --strictPort`,url:baseURL,reuseExistingServer:!process.env.CI,timeout:30000 },
});
