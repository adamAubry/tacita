import type { MatrixClient } from "matrix-js-sdk";

import type { Session } from "./session";

/**
 * Complète un mock partiel de `Session` en contrat entier. Suite de l'audit des
 * jonctions, qui avait relevé le trou sans le fermer.
 *
 * Ce qu'il ferme : chaque paquet mockait `Session` de son côté en
 * `Partial<Omit<Session, "client">>` puis un double cast. Un membre **ajouté** au
 * contrat n'apparaissait donc nulle part — `Partial` l'accepte absent, le cast
 * éteint le reste — et sortait en `undefined is not a function` chez le seul
 * consommateur qui compose les sept paquets : le shard UI (spec 11).
 * `identityResetOf` et `confirmIdentityOf`, ajoutés le 04/08/2026, sont passés
 * exactement par là.
 *
 * Deux gardes :
 *
 * - le `satisfies Session` ci-dessous **est** le site de compilation du contrat.
 *   Ajouter un membre à `Session` casse ce fichier — et lui seul est à compléter,
 *   les six mocks en héritent ;
 * - un membre non fourni **lève en se nommant**, au lieu de manquer en silence.
 *   Un test qui atteint un membre qu'il n'a pas stubbé doit le dire.
 *
 * `client` reste un faux assumé : exiger un vrai `MatrixClient` demanderait
 * 357 propriétés. C'est le seul cast, et il est confiné ici.
 */
export function asSession(mock: { client: unknown } & Partial<Omit<Session, "client">>): Session {
  const absent =
    (membre: string) =>
    (): never => {
      throw new Error(`Session mockée : \`${membre}\` n'est pas stubbé dans ce test`);
    };

  return {
    timeline: absent("timeline"),
    isEncrypted: absent("isEncrypted"),
    recoveryRequired: absent("recoveryRequired"),
    setupRecoveryKey: absent("setupRecoveryKey"),
    identityResetOf: absent("identityResetOf"),
    confirmIdentityOf: absent("confirmIdentityOf"),
    registerWipe: absent("registerWipe"),
    logout: absent("logout"),
    ...mock,
    client: mock.client as MatrixClient,
  } satisfies Session;
}
