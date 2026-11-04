import { defineConfig } from "vitest/config";

// End-to-end demos (UM-032) run through vitest so the TypeScript modules of sdk, backend and agents can be imported directly.
export default defineConfig({
  test: { include: ["demo/*.demo.ts"], env: { NEARAI_MODE: "mock", NEARAI_API_KEY: "" }, testTimeout: 3_600_000 },
});
