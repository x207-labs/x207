import { defineConfig } from "vitest/config";

// Integration tests of the umbrella (near-sandbox). Run: npm run test:integration (X207_SANDBOX=1 is set by the script).
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], globalSetup: ["tests/support/build-sdk.ts"], env: { NEARAI_MODE: "mock", NEARAI_API_KEY: "", API_LIMITS: "off", BROKER_LIMITS: "off" } },
});
