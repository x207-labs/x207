import { defineConfig } from "vitest/config";

// Demo end-to-end (UM-032) dijalankan lewat vitest supaya modul TypeScript sdk, backend, dan agents bisa diimpor langsung.
export default defineConfig({
  test: { include: ["demo/*.demo.ts"], env: { NEARAI_MODE: "mock", NEARAI_API_KEY: "" }, testTimeout: 3_600_000 },
});
