import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { restoreSession, type Session } from "@tacita/client-core";
import { searchUsers, updateProfile } from "@tacita/messaging";

import {
  HOMESERVER,
  registerAccount,
  semerCredentials,
  uniqueLocalpart,
  type Account,
} from "./harness";

/**
 * **l'annuaire répond, et il répond à quelqu'un qui ne partage rien.**
 *
 * Règle 4 du dépôt : le test de config atteste que `search_all_users: true` est écrit
 * dans le fichier ; il n'atteste pas que chercher une personne la trouve. C'est
 * exactement l'écart qui a produit E-21 — le réglage par défaut était parfaitement
 * conforme à une spec qui ne disait rien, et « Ajouter un ami » ne trouvait personne.
 *
 * Les deux comptes d'ici **n'ont aucun salon en commun** et n'en auront pas : c'est la
 * condition qui rendait l'annuaire muet avant la décision, et donc la seule qui prouve
 * quelque chose maintenant.
 *
 * Si ce fichier passe au rouge, regarder dans cet ordre : le réglage dans
 * `homeserver.yaml`, puis la reconstruction de l'annuaire (`regenerate_directory`,
 * procédure dans `infra/README.md`) — un index en retard donne exactement le même
 * symptôme qu'un réglage absent.
 */

const ATTENTE = { timeout: 30_000, interval: 500 };

/** Le nom d'affichage de la cible, distinct de son localpart : on cherche bien un nom. */
const NOM_AFFICHE = "Zoé Pérez";

let chercheuse: Session;
let cible: { compte: Account; session: Session };

async function ouvrir(prefixe: string): Promise<{ compte: Account; session: Session }> {
  const compte = await registerAccount(uniqueLocalpart(prefixe));
  const disque = new IDBFactory(); // un appareil distinct = un disque distinct
  await semerCredentials(disque, compte);
  const session = await restoreSession({ homeserverUrl: HOMESERVER, indexedDB: disque });
  if (!session) throw new Error(`session ${prefixe} non ouverte`);
  return { compte, session };
}

beforeAll(async () => {
  // Aucun `setupRecoveryKey` ici : l'annuaire ne demande aucune clé, et le cross-signing
  // appartient aux cibles qui éprouvent le chiffrement.
  cible = await ouvrir("zoe");
  await updateProfile(cible.session, { displayName: NOM_AFFICHE });
  chercheuse = (await ouvrir("iris")).session;
}, 120_000);

describe("l'annuaire couvre tous les comptes du serveur", () => {
  it("un fragment de nom d'affichage trouve quelqu'un avec qui on ne partage aucun salon", async () => {
    // L'index de l'annuaire est alimenté en fond : on attend qu'il rattrape, plutôt que
    // de conclure à un réglage absent sur une course.
    const trouves = await vi.waitFor(async () => {
      const resultats = await searchUsers(chercheuse, "Zoé");
      expect(resultats.map((profil) => profil.userId)).toContain(cible.compte.userId);
      return resultats;
    }, ATTENTE);

    expect(trouves.find((profil) => profil.userId === cible.compte.userId)?.displayName).toBe(
      NOM_AFFICHE,
    );
  });

  it("un fragment d'identifiant aussi — c'est le « exact match » que les retours nommaient", async () => {
    // `@zoe…` : on tape le début de l'identifiant, pas l'adresse entière. Avant E-21,
    // seule l'adresse complète aboutissait, par le chemin du profil.
    const debut = cible.compte.userId.slice(1, 5);

    const trouves = await vi.waitFor(async () => {
      const resultats = await searchUsers(chercheuse, debut);
      expect(resultats.map((profil) => profil.userId)).toContain(cible.compte.userId);
      return resultats;
    }, ATTENTE);

    expect(trouves.length).toBeGreaterThan(0);
  });

  it("l'identifiant sans domaine résout la bonne personne", async () => {
    // le chemin du profil, complété avec le domaine du compte
    // courant. Il doit rester exact : c'est lui qui répond quand l'annuaire retarde.
    const localpart = cible.compte.userId.split(":")[0].slice(1);

    const trouves = await searchUsers(chercheuse, localpart);
    expect(trouves[0]?.userId).toBe(cible.compte.userId);
    expect(trouves[0]?.displayName).toBe(NOM_AFFICHE);
  });

  it("une saisie qui ne désigne personne ne rend personne", async () => {
    // La contrepartie du test précédent : `profileOf` retombe sur l'identifiant lui-même
    // quand le profil est introuvable, et proposer ce repli ferait
    // « trouver » n'importe quelle saisie.
    expect(await searchUsers(chercheuse, uniqueLocalpart("personne"))).toEqual([]);
  });
});
