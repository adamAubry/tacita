import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // La cible de fumée exige une pile Docker debout : elle ne fait pas partie de
    // la suite par défaut, que le hook de pré-commit lance à chaque commit. Elle a
    // sa propre config et son propre script (`npm run smoke`).
    exclude: ["**/node_modules/**", "smoke/**"],
  },
});
