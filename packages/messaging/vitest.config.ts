import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // matrix-js-sdk publie des imports de répertoire (`./http-api`) que le loader ESM
    // de Node refuse. Inliné, c'est Vite qui le résout — sinon les constantes du SDK
    // (EventType, RelationType) ne sont pas chargeables en test.
    server: { deps: { inline: ["matrix-js-sdk"] } },
  },
});
