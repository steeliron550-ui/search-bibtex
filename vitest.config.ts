import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["refs/**", "dist/**", "dist-bin/**", "dist-pkg/**", "node_modules/**"]
  }
});
