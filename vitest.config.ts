import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone config so domain tests don't load the app's Vite/TanStack plugins.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
