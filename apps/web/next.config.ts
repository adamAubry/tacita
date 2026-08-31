import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * Sert la PWA depuis le compose (infra/docker-compose.yml, service `web`, derrière le
 * proxy sur `location /`).
 */
const config: NextConfig = {
  // Image Docker autonome : Next trace le strict nécessaire dans `.next/standalone`
  // plutôt que d'embarquer tout le node_modules du monorepo pnpm.
  output: "standalone",
  // Monorepo : la racine de traçage est le dépôt, pas `apps/web` — sinon les paquets
  // `@tacita/*` (symlinks pnpm vers du TS source) et leurs fichiers ne sont pas copiés
  // dans le bundle autonome.
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  // Ces paquets exportent du TypeScript source (`exports: "./src/index.ts"`, pas de
  // `dist/`) : Next doit les transpiler comme du code applicatif.
  transpilePackages: [
    "@tacita/client-core",
    "@tacita/media-pipeline",
    "@tacita/messaging",
    "@tacita/outbox",
    "@tacita/receipts",
    "@tacita/search",
  ],
};

export default config;
