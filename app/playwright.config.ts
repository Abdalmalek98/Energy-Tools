import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "e2e", testMatch: /.*\.e2e\.ts/, workers: 1, timeout: 180_000, expect: { timeout: 20_000 }, reporter: [["list"]], use: { trace: "off" } });
