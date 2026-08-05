export type LinkKind = "friend" | "group";

/**
 * REQ-INV-18 — tout ce que le service retient d'un lien. Aucun nom d'affichage, aucun
 * libellé de salon, aucun contenu : ce qui n'est pas là ne peut pas fuiter.
 */
export interface Link {
  id: string;
  issuer: string;
  kind: LinkKind;
  roomId: string | null;
  /** Epoch ms. Comparé à l'horloge du serveur, jamais à une date fournie (REQ-INV-17). */
  expiresAt: number;
  usesLeft: number;
}

export interface NewLink {
  tokenHash: string;
  issuer: string;
  kind: LinkKind;
  roomId: string | null;
  expiresAt: number;
  maxUses: number;
}

export interface Found {
  link: Link;
  /** REQ-INV-13 — ce porteur a déjà résolu ce lien : la reprise ne consomme rien. */
  repeated: boolean;
}

export interface Store {
  create(link: NewLink): Promise<Link>;
  /** REQ-INV-04 — les liens actifs d'un émetteur, jamais ceux d'un autre. */
  listByIssuer(issuer: string, now: number): Promise<Link[]>;
  /** REQ-INV-05 — rend `false` si le lien n'est pas à cet émetteur : rien ne le distingue d'un lien inexistant. */
  revoke(id: string, issuer: string): Promise<boolean>;
  /** Lecture seule : de quoi appliquer REQ-INV-12 à REQ-INV-15 **avant** de consommer. */
  find(tokenHash: string, bearer: string, now: number): Promise<Found | undefined>;
  /** REQ-INV-07 — décrément et lecture dans la même instruction. `undefined` = perdu ou épuisé. */
  consume(tokenHash: string, bearer: string, now: number): Promise<Link | undefined>;
  /** REQ-INV-18 — une trace de lien n'a aucune raison de survivre à sa validité. */
  purge(now: number): Promise<number>;
}

/**
 * REQ-INV-18 — le schéma **est** la liste de ce que le service sait. Y ajouter une
 * colonne, c'est ajouter à ce qu'une saisie de la base apprendrait : ça se discute avec
 * le PM, pas dans une migration.
 *
 * `link_resolutions` porte l'idempotence de REQ-INV-13 ; son unicité est ce qui fait
 * qu'une reprise ne consomme pas un second usage.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  text NOT NULL UNIQUE,
  issuer      text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('friend', 'group')),
  room_id     text,
  expires_at  bigint NOT NULL,
  uses_left   integer NOT NULL CHECK (uses_left >= 0),
  revoked     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS links_issuer_idx ON links (issuer);

CREATE TABLE IF NOT EXISTS link_resolutions (
  link_id uuid NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  bearer  text NOT NULL,
  PRIMARY KEY (link_id, bearer)
);
`;

/** Le strict nécessaire d'un client PostgreSQL — `pg` n'apparaît qu'au démarrage. */
export type Sql = (text: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

const toLink = (row: Record<string, unknown>): Link => ({
  id: row.id as string,
  issuer: row.issuer as string,
  kind: row.kind as LinkKind,
  roomId: (row.room_id as string | null) ?? null,
  // `bigint` revient en chaîne : `pg` ne suppose pas qu'il tient dans un `number`.
  expiresAt: Number(row.expires_at),
  usesLeft: Number(row.uses_left),
});

/**
 * REQ-INV-07 — **une seule instruction** consomme. Un `SELECT` suivi d'un `UPDATE`
 * laisserait deux porteurs franchir le dernier usage : entre les deux, chacun voit
 * `uses_left = 1`. Ici le garde `uses_left > 0` vit dans le `WHERE` de l'`UPDATE` ;
 * PostgreSQL réévalue la condition après avoir pris le verrou de ligne, donc le second
 * ne met rien à jour et ne rend rien.
 *
 * ponytail: deux résolutions **du même porteur** en course peuvent décrémenter deux
 * fois avant que `link_resolutions` ne les départage. Un porteur qui double-clique
 * perd un usage d'un lien multi-usages, jamais un accès. Sérialiser par
 * `SELECT … FOR UPDATE` le jour où un lien multi-usages coûte quelque chose.
 */
const CONSUME = `
WITH consumed AS (
  UPDATE links SET uses_left = uses_left - 1
   WHERE token_hash = $1
     AND NOT revoked
     AND expires_at > $3
     AND uses_left > 0
     AND issuer <> $2
     AND NOT EXISTS (SELECT 1 FROM link_resolutions r WHERE r.link_id = links.id AND r.bearer = $2)
  RETURNING id, issuer, kind, room_id, expires_at, uses_left
),
recorded AS (
  INSERT INTO link_resolutions (link_id, bearer)
  SELECT id, $2 FROM consumed
  ON CONFLICT DO NOTHING
  RETURNING link_id
)
SELECT * FROM consumed
`;

export function createPostgresStore(sql: Sql): Store {
  return {
    async create({ tokenHash, issuer, kind, roomId, expiresAt, maxUses }) {
      const { rows } = await sql(
        `INSERT INTO links (token_hash, issuer, kind, room_id, expires_at, uses_left)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, issuer, kind, room_id, expires_at, uses_left`,
        [tokenHash, issuer, kind, roomId, expiresAt, maxUses],
      );
      return toLink(rows[0]!);
    },

    async listByIssuer(issuer, now) {
      const { rows } = await sql(
        `SELECT id, issuer, kind, room_id, expires_at, uses_left FROM links
          WHERE issuer = $1 AND NOT revoked AND expires_at > $2 AND uses_left > 0
          ORDER BY expires_at`,
        [issuer, now],
      );
      return rows.map(toLink);
    },

    async revoke(id, issuer) {
      const { rows } = await sql(
        `UPDATE links SET revoked = true WHERE id = $1 AND issuer = $2 AND NOT revoked RETURNING id`,
        [id, issuer],
      );
      return rows.length > 0;
    },

    async find(tokenHash, bearer, now) {
      const { rows } = await sql(
        `SELECT l.id, l.issuer, l.kind, l.room_id, l.expires_at, l.uses_left,
                EXISTS (SELECT 1 FROM link_resolutions r WHERE r.link_id = l.id AND r.bearer = $2) AS repeated
           FROM links l
          WHERE l.token_hash = $1 AND NOT l.revoked AND l.expires_at > $3`,
        [tokenHash, bearer, now],
      );
      const row = rows[0];
      return row && { link: toLink(row), repeated: row.repeated === true };
    },

    async consume(tokenHash, bearer, now) {
      const { rows } = await sql(CONSUME, [tokenHash, bearer, now]);
      return rows[0] && toLink(rows[0]);
    },

    /**
     * REQ-INV-18 — **l'expiration seule** purge. Un lien épuisé reste jusqu'à sa date :
     * c'est lui qui porte l'idempotence de REQ-INV-13, et l'effacer ferait échouer la
     * reprise d'un porteur qui rouvre son lien. Un lien révoqué part avec les autres à
     * son échéance ; `find` l'ignore déjà, il n'est joignable par personne entre-temps.
     */
    async purge(now) {
      const { rows } = await sql(`DELETE FROM links WHERE expires_at <= $1 RETURNING id`, [now]);
      return rows.length;
    },
  };
}
