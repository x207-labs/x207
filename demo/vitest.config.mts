import { defineConfig } from "vitest/config";

// End-to-end demos (UM-032) run through vitest so the TypeScript modules of sdk, backend and agents can be imported directly.
export default defineConfig({
  // AG-034: X207_DEMO_NEARAI=live hands the key of the shell (agents/.env) to the agents; everything else stays mock with no key.
  test: {
    include: ["demo/*.demo.ts"],
    env: process.env.X207_DEMO_NEARAI === "live" ? { NEARAI_MODE: "live", NEARAI_API_KEY: process.env.NEARAI_API_KEY ?? "" } : { NEARAI_MODE: "mock", NEARAI_API_KEY: "" },
    testTimeout: 3_600_000,
  },
});
