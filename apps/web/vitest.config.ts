import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next impose `jsx: "preserve"` dans le tsconfig — il fait sa propre transformation —,
  // ce qui laisserait le JSX intact sous Vitest. On la demande donc explicitement ici :
  // sans cette ligne, chaque test échoue sur « React is not defined ».
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // Astryx est publié en ESM avec 123 sous-chemins : inliné, Vite les résout comme le
    // bundler de l'app plutôt que par le loader ESM de Node.
    server: { deps: { inline: ["@astryxdesign/core"] } },
  },
});
