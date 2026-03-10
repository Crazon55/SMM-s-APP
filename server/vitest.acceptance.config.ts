import { defineConfig } from "vitest/config";
import tsconfig from "./tsconfig.json" assert { type: "json" };

export default defineConfig({
  test: {
    include: ["src/**/*.acceptance.test.ts"],
    testTimeout: 15000,
  },
  resolve: {
    extensions: [".ts"],
  },
  esbuild: { target: "es2022" },
});
