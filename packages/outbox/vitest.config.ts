import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Voir packages/messaging/vitest.config.ts : les imports de répertoire du SDK
    // sont refusés par le loader ESM de Node, il faut laisser Vite les résoudre.
    server: { deps: { inline: ["matrix-js-sdk"] } },
  },
});
