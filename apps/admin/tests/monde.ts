import type { Contexte, Systeme } from "../src/contrat.ts";

/** Une machine qui remplit toutes les prémisses. Chaque test n'écrase que ce qu'il éprouve. */
export const SYSTEME_SAIN: Systeme = {
  plateforme: "linux",
  versionNode: "v22.14.0",
  memoireOctets: 8 * 1024 ** 3,
  swapOctets: 4 * 1024 ** 3,
  estRoot: false,
};

/**
 * Le monde par défaut : tout va bien, rien n'est branché. Centralisé ici parce que le
 * `Contexte` s'est étendu deux fois, et qu'il le fera encore — répéter ses valeurs par
 * défaut dans chaque fichier de test ferait payer chaque extension trois fois.
 */
export const monde = (modifications: Partial<Contexte> = {}): Contexte => ({
  env: new Map(),
  lire: () => undefined,
  maintenant: new Date("2026-08-25T00:00:00Z"),
  dev: false,
  systeme: SYSTEME_SAIN,
  espaceLibreOctets: () => 100 * 1024 ** 3,
  executer: async () => ({ code: 0, sortie: "" }),
  sonderPort: async () => "libre",
  resoudre: async () => [],
  adressesLocales: () => ["203.0.113.10"],
  ...modifications,
});
