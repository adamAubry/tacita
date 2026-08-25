import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `matrix-js-sdk` publie des imports de répertoire (`lib/oauth/index.js` tire
    // `lib/http-api`) que le loader ESM de Node refuse. La suite s'en passait tant qu'elle
    // n'importait du SDK que des sous-chemins feuilles ; `SecretStorage`, dont
    // `key-check-python.test.ts` a besoin, passe par le barrel et les traverse tous.
    //
    // Inliné, Vite le résout comme le bundler de l'app — même remède, même motif, que
    // `apps/web` et `packages/messaging`.
    server: { deps: { inline: ["matrix-js-sdk"] } },
  },
});
