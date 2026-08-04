import { defineConfig } from "vitest/config";

/**
 * Config séparée, et volontairement hors du workspace : la cible de fumée exige
 * une pile Docker debout. Le hook de pré-commit lance la suite par défaut à chaque
 * commit — l'y inclure la casserait pour quiconque n'a pas Docker démarré.
 *
 * Lancement : `npm run smoke` (voir README.md de ce dossier).
 */
export default defineConfig({
  test: {
    include: ["**/*.smoke.test.ts"],
    // Vraie crypto Rust, vrai IndexedDB, vrai Synapse : les secondes comptent
    // autrement que dans une suite sur mocks.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Un seul fichier, un seul serveur : rien à paralléliser, et deux clients
    // Matrix concurrents sur le même Synapse rendraient les échecs illisibles.
    fileParallelism: false,
    // Voir packages/messaging/vitest.config.ts : matrix-js-sdk publie des imports
    // de répertoire que le loader ESM de Node refuse ; inliné, Vite les résout.
    server: { deps: { inline: ["matrix-js-sdk"] } },
  },
});
