import { defineConfig } from "vitest/config";

// Test integrasi payung (near-sandbox). Jalankan: npm run test:integration (X207_SANDBOX=1 diset oleh skrip).
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], globalSetup: ["tests/support/build-sdk.ts"], env: { NEARAI_MODE: "mock", NEARAI_API_KEY: "", API_LIMITS: "off", BROKER_LIMITS: "off" } },
});
