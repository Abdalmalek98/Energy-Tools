import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "e2e", testMatch: /accuracy\.run\.ts/, workers: 1, timeout: 30 * 60_000, reporter: [["list"]] });
