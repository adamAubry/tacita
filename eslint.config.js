// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.next/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Les signatures de mocks doivent porter les paramètres du vrai type, même inutilisés.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Le service worker (REQ-UI-01) s'exécute dans un contexte qui n'est ni Node ni la
    // page : `self`, `caches`, `Response` y sont natifs. Sans ces globales déclarées,
    // le lint le refuse ligne par ligne — et le désactiver fichier entier ferait perdre
    // le reste des règles sur le seul fichier qui touche au cache.
    files: ["apps/web/public/sw.js"],
    languageOptions: {
      globals: Object.fromEntries(
        [
          "self",
          "caches",
          "fetch",
          "Response",
          "URL",
          "Request",
          // Le réveil push (REQ-UI-18) : il interroge une fenêtre par `MessageChannel`,
          // avec un délai au-delà duquel la notification part générique.
          "MessageChannel",
          "setTimeout",
          "clearTimeout",
        ].map((nom) => [nom, "readonly"]),
      ),
    },
  },
  {
    // `next-env.d.ts` est généré par Next à chaque build : le corriger le ferait
    // réécrire au suivant.
    files: ["apps/web/next-env.d.ts"],
    rules: { "@typescript-eslint/triple-slash-reference": "off" },
  },
);
