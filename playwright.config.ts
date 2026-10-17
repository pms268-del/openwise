import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

// Use the preinstalled Chromium in CI/sandbox images when present.
const exe = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", launchOptions: exe ? { executablePath: exe } : {} },
  reporter: [["list"]],
});
