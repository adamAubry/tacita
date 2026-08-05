import type { Link, NewLink, Store } from "../src/store.ts";

/**
 * Imitation de PostgreSQL pour la suite : mêmes règles, mêmes refus.
 *
 * **Ce qu'elle ne prouve pas** : l'atomicité de REQ-INV-07. En JavaScript, une section
 * sans `await` est atomique par construction — une file d'attente qui se confirme
 * elle-même. Ce qui la prouve est ailleurs : `store.test.ts` asserte que la consommation
 * est **une seule instruction SQL** avec son garde dans le `WHERE`, et LIMITES.md dit
 * que le comportement concurrent réel ne se vérifie que contre un vrai PostgreSQL.
 *
 * Ce que la course modélisée ci-dessous prouve, en revanche : que `resolve()` ne
 * décide pas lui-même du dernier usage entre son `find` et son `consume`.
 */
export function createMemoryStore(): Store & { rows: Map<string, Link & { tokenHash: string; revoked: boolean }> } {
  const rows = new Map<string, Link & { tokenHash: string; revoked: boolean }>();
  const resolutions = new Set<string>();
  let nextId = 0;

  const byToken = (tokenHash: string, now: number) =>
    [...rows.values()].find(
      (row) => row.tokenHash === tokenHash && !row.revoked && row.expiresAt > now,
    );

  return {
    rows,

    async create(link: NewLink) {
      const row = {
        id: `lien-${++nextId}`,
        tokenHash: link.tokenHash,
        issuer: link.issuer,
        kind: link.kind,
        roomId: link.roomId,
        expiresAt: link.expiresAt,
        usesLeft: link.maxUses,
        revoked: false,
      };
      rows.set(row.id, row);
      return { ...row };
    },

    async listByIssuer(issuer, now) {
      return [...rows.values()]
        .filter((row) => row.issuer === issuer && !row.revoked && row.expiresAt > now && row.usesLeft > 0)
        .map((row) => ({ ...row }));
    },

    async revoke(id, issuer) {
      const row = rows.get(id);
      if (!row || row.issuer !== issuer || row.revoked) return false;
      row.revoked = true;
      return true;
    },

    async find(tokenHash, bearer, now) {
      const row = byToken(tokenHash, now);
      return row && { link: { ...row }, repeated: resolutions.has(`${row.id}|${bearer}`) };
    },

    async consume(tokenHash, bearer, now) {
      // Le point d'ordonnancement est **avant** la section critique, comme l'attente du
      // verrou de ligne côté PostgreSQL ; ce qui suit s'exécute d'un bloc, comme
      // l'instruction unique de `CONSUME`.
      await Promise.resolve();

      const row = byToken(tokenHash, now);
      if (!row || row.usesLeft < 1 || row.issuer === bearer) return undefined;
      if (resolutions.has(`${row.id}|${bearer}`)) return undefined;

      row.usesLeft -= 1;
      resolutions.add(`${row.id}|${bearer}`);
      return { ...row };
    },

    async purge(now) {
      const expirés = [...rows.values()].filter((row) => row.expiresAt <= now);
      for (const row of expirés) rows.delete(row.id);
      return expirés.length;
    },
  };
}
