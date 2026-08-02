import { defineConfig } from "vitest/config";

// matrix-js-sdk publie de l'ESM avec des imports de répertoire, que Node refuse mais
// que Vite résout : on l'inline plutôt que de le laisser externaliser.
export default defineConfig({
  test: { server: { deps: { inline: ["matrix-js-sdk", "matrix-widget-api"] } } },
});
