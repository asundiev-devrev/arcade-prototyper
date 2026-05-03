import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: [
      { find: /^arcade\/components$/, replacement: path.resolve(__dirname, "prototype-kit/arcade-components.tsx") },
      { find: /^arcade$/,              replacement: path.resolve(__dirname, "prototype-kit/arcade-components.tsx") },
      { find: "arcade-prototypes",     replacement: path.resolve(__dirname, "prototype-kit") },
    ],
  },
  test: {
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./__tests__/setup.ts"],
    // gridstack 12.3.3 uses an extensionless subpath import (`./gridstack-engine`)
    // that Node ESM can't resolve. Arcade-gen's barrel pulls it via Dashboard.
    // Forcing it through vite's optimizer pre-bundles + rewrites the import.
    deps: {
      optimizer: {
        web: { include: ["gridstack"] },
      },
    },
  },
});
