import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "test/empty.ts"),
    },
  },
  test: {
    setupFiles: ["test/setup.ts"],
    projects: [
      {
        extends: true,
        test: { name: "node", include: ["src/**/*.test.ts", "spike/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: { name: "dom", include: ["src/**/*.test.tsx"], environment: "jsdom" },
      },
    ],
  },
});
