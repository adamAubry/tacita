import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it } from "vitest";

import { connexionParCle, creerCompte, initSession, type Session } from "@tacita/client-core";

import { HOMESERVER, uniqueLocalpart } from "./harness";

/**
 * **Cible de fumée du parcours d'entrée** — créée, après un défaut que
 * 1039 tests verts n'ont pas vu : un compte se connectait et tombait sur « Entrez votre
 * clé de récupération ».
 *
 * Règle 4 — « module terminé » et « produit qui marche » sont deux portes. Tout ce qui
 * suit se joue contre la vraie crypto Rust, un vrai IndexedDB et un vrai Synapse : les
 * mocks de `packages/client-core` répondent ce qu'on leur a appris, et c'est exactement
 * ce qui rend cette cible-ci nécessaire.
 *
 * Le disque est **neuf entre les deux sessions** : c'est ce qui fait de la seconde une
 * *deuxième connexion*, avec un `device_id` neuf — le cas que le produit doit tenir.
 */
const MOT_DE_PASSE = "motdepasse-essai";

let identifiant: string;
let cle: string;

beforeAll(async () => {
  identifiant = uniqueLocalpart("parcours");
});

describe("D-13 / l'inscription pose une identité, pas seulement une clé", () => {
  it("créer un compte puis sa clé rend l'appareil prêt à chiffrer", async () => {
    const session = await creerCompte({
      homeserverUrl: HOMESERVER,
      identifiant,
      motDePasse: MOT_DE_PASSE,
      indexedDB: new IDBFactory(),
    });

    // L'état d'un compte neuf : rien à déverrouiller, tout à créer.
    await expect(session.recoveryState()).resolves.toBe("creation");

    const generee = await session.setupRecoveryKey();
    cle = generee.encodedPrivateKey;

    /*
     * **Le cœur de la cible.** `setupRecoveryKey` provisionne le secret storage *puis*
     * dépose l'identité cross-signing. Un compte qui repart d'ici avec une clé et sans
     * identité est le pire état du produit : il a de quoi ouvrir un magasin vide, et
     * aucune de ses futures connexions ne pourra chiffrer.
     */
    await expect(session.recoveryState()).resolves.toBe("prete");
  });
});

describe("se connecter avec son identifiant et son mot de passe suffit", () => {
  it("une deuxième connexion, sur un appareil neuf, entre dans l'application", async () => {
    /*
     * Le défaut remonté : « j'ai tenté de me connecter et j'ai eu un écran
     * "entrez votre clé de récupération" ». Un appareil neuf n'est pas signé et ne peut
     * pas chiffrer — mais l'utilisateur vient de donner le seul secret que le produit lui
     * demande de retenir, et le produit doit s'en contenter.
     */
    const session: Session = await initSession({
      homeserverUrl: HOMESERVER,
      identifiant,
      motDePasse: MOT_DE_PASSE,
      indexedDB: new IDBFactory(),
    });

    await expect(session.recoveryState()).resolves.toBe("prete");
  });
});

describe("D-14 — la porte de secours ouvre une session, avec la clé seule", () => {
  it("la clé de récupération ouvre une session déjà déverrouillée", async () => {
    const session = await connexionParCle({
      homeserverUrl: HOMESERVER,
      identifiant,
      cleRecuperation: cle,
      indexedDB: new IDBFactory(),
    });

    await expect(session.recoveryState()).resolves.toBe("prete");
  });
});

describe("« j'ai perdu ma clé » remplace la clé et l'identité", () => {
  it("la réinitialisation aboutit, mot de passe à l'appui", async () => {
    /*
     * **Le constat critique de l'audit.** Remplacer une identité
     * cross-signing demande une ré-authentification, et le client ne savait franchir que
     * `m.login.sso` — hérité de Keycloak, supprimé le matin même par D-12. Mesuré ici :
     * `401 flows:[[m.login.password]]`, l'écran de confirmation n'était même pas appelé,
     * et une clé perdue devenait un historique perdu.
     *
     * Aucun test sur mocks ne pouvait le voir : le mock répondait le flow qu'on lui avait
     * appris. C'est le serveur qui a le dernier mot sur la forme de son épreuve.
     */
    const session = await initSession({
      homeserverUrl: HOMESERVER,
      identifiant,
      motDePasse: MOT_DE_PASSE,
      indexedDB: new IDBFactory(),
    });

    const neuve = await session.setupRecoveryKey({ reinitialiser: true });

    expect(neuve.encodedPrivateKey).toBeTruthy();
    expect(neuve.encodedPrivateKey).not.toBe(cle);
    // L'identité est déposée et cet appareil est signé : c'est ce qui distingue une
    // réinitialisation aboutie d'un secret storage remplacé à moitié.
    await expect(session.recoveryState()).resolves.toBe("prete");
  });
});

describe("les appareils se listent et se déconnectent", () => {
  it("la session voit les autres, et les ferme avec le mot de passe", async () => {
    /*
     * Sans ce chemin, une fuite de jeton n'avait aucune réponse : les jetons n'expirent
     * pas, et le changement de mot de passe ne déconnecte volontairement personne.
     */
    const disque = new IDBFactory();
    const session = await initSession({
      homeserverUrl: HOMESERVER,
      identifiant,
      motDePasse: MOT_DE_PASSE,
      indexedDB: disque,
    });

    const avant = await session.appareils();
    expect(avant.filter((appareil) => appareil.courant)).toHaveLength(1);
    const autres = avant.filter((appareil) => !appareil.courant);
    expect(autres.length).toBeGreaterThan(0);

    await session.revoquerAppareils(autres.map((appareil) => appareil.id));

    const apres = await session.appareils();
    expect(apres).toHaveLength(1);
    expect(apres[0]!.courant).toBe(true);
  });
});
