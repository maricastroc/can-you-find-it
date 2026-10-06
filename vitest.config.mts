import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next.js resolves this to an empty module on the server; tests run on the server.
      "server-only": path.resolve(__dirname, "test/empty.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "spike/**/*.test.ts"],
    environment: "node",
    setupFiles: ["test/setup.ts"],
  },
});
