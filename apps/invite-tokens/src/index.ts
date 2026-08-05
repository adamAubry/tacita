import pg from "pg";

import { createMatrixReader } from "./matrix.ts";
import { createInviteService } from "./server.ts";
import { createPostgresStore, SCHEMA } from "./store.ts";

const { DATABASE_URL, HOMESERVER_URL, PORT = "8009", PURGE_INTERVAL_MS = "3600000" } = process.env;
if (!DATABASE_URL || !HOMESERVER_URL) {
  throw new Error("DATABASE_URL et HOMESERVER_URL sont requis (voir README.md).");
}

/**
 * Aucun jeton d'administration Synapse ici, et il n'y en aura pas : le service n'exécute
 * aucune action Matrix (spec 12). Il lit `whoami`, l'`m.ignored_user_list` et le profil
 * **avec le jeton de l'appelant**, jamais avec un pouvoir à lui. Un test de configuration
 * asserte l'absence de secret d'administration dans son environnement (REQ-INF-15).
 */
const pool = new pg.Pool({ connectionString: DATABASE_URL });
await pool.query(SCHEMA);

const store = createPostgresStore((text, params) => pool.query(text, params));

// REQ-INV-18 — les lignes expirées sont purgées : une trace de lien n'a aucune raison de
// survivre à sa validité. `unref` pour que le minuteur ne retienne pas le processus.
setInterval(() => {
  void store.purge(Date.now()).catch(() => console.warn("purge", { outcome: "rejected" }));
}, Number(PURGE_INTERVAL_MS)).unref();

createInviteService({ store, matrix: createMatrixReader(HOMESERVER_URL) }).listen(
  Number(PORT),
  () => console.info("listening", { port: PORT }),
);
