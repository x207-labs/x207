import { defineConfig } from "vitest/config";

// Test integrasi payung (near-sandbox). Jalankan: npm run test:integration (X207_SANDBOX=1 diset oleh skrip).
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], env: { NEARAI_MODE: "mock", NEARAI_API_KEY: "" } },
});
