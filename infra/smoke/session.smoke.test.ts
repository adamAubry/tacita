import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { restoreSession, type Session } from "@tacita/client-core";
import { createGroupChat, messages, sendText } from "@tacita/messaging";

import {
  HOMESERVER,
  registerAccount,
  semerCredentials,
  uniqueLocalpart,
  type Account,
} from "./harness";

/**
 * Le défaut de `vi.waitFor` est d'une seconde : ici on attend un aller-retour
 * réseau et un tour de `/sync`, pas un timer qu'on pourrait avancer.
 */
const ATTENTE = { timeout: 30_000, interval: 250 };

/**
 * Cible de fumée — arbitrage PM, point 9, option B.
 *
 * Ce que valide ce fichier, et que 189 tests sur mocks ne valident pas : la crypto
 * Rust (vodozemac) réelle, un vrai IndexedDB, un vrai Synapse, et le fait que nos
 * packages tiennent ensemble contre eux. Sept modules seront intégrés d'un coup par
 * `apps/web` ; c'est ici qu'on découvre les écarts, pas là-bas.
 *
 * Hors périmètre, décidé et non subi : le tronçon OIDC (`initSession`). Voir
 * `harness.ts` et le ticket OIDC.
 */

/**
 * Une seule IndexedDB pour toute la série : c'est elle qui joue le disque du
 * navigateur. La partager d'un test à l'autre **est** le sujet — un rechargement de
 * page, c'est des objets neufs sur le même disque.
 */
const disque = new IDBFactory();

let compte: Account;
let session: Session;
let salon: string;

beforeAll(async () => {
  compte = await registerAccount(uniqueLocalpart("smoke"));

  // Le jeton vient du secret partagé plutôt que de l'OIDC, mais il est ensuite
  // consommé par le vrai chemin : on sème le magasin de credentials, et c'est
  // `restoreSession` — le code de C4 — qui ouvre la session.
  await semerCredentials(disque, compte);
  const restaurée = await restoreSession({ homeserverUrl: HOMESERVER, indexedDB: disque });
  expect(restaurée, "restoreSession n'a pas rendu de session").not.toBeNull();
  session = restaurée!;

  // / D-08 — sous le mode « appareils signés uniquement », un compte sans
  // identité cross-signing ne peut pas chiffrer *du tout* : la crypto Rust rejette
  // avec « Encryption failed because cross-signing is not set up on your account ».
  // Le bootstrap n'est donc plus seulement la condition pour être *lu*, c'est la
  // condition pour *écrire*. L'onboarding l'impose déjà (l'UI bloque tant que le
  // backup n'est pas configuré) ; ce test doit passer par le même chemin.
  await session.setupRecoveryKey();
});

afterAll(async () => {
  session?.client.stopClient();
});

describe("Fumée — chiffrement de bout en bout contre un vrai Synapse", () => {
  it("ouvre une session avec la crypto Rust prête", async () => {
    const crypto = session.client.getCrypto();
    expect(crypto, "aucune crypto : le SDK n'a pas initialisé vodozemac").toBeDefined();
    // le backend réellement chargé, pas celui que la config annonce.
    expect(await crypto!.getVersion()).toMatch(/vodozemac/i);
    expect(session.client.getUserId()).toBe(compte.userId);
  });

  it("crée un salon effectivement chiffré côté serveur", async () => {
    const { room_id } = await createGroupChat(session, "salon de fumée");
    salon = room_id;

    // pas « la config dit que ça devrait être chiffré »,
    // mais « le serveur a bien enregistré l'événement d'état, et le SDK le voit ».
    await vi.waitFor(
      async () =>
        expect(await session.client.getCrypto()!.isEncryptionEnabledInRoom(salon)).toBe(true),
      ATTENTE,
    );
  });

  it("un message envoyé revient déchiffré par le flux /sync", async () => {
    const texte = `rendez-vous au parc ${Date.now()}`;
    const { event_id } = await sendText(session, salon, texte);

    // Le tour complet : chiffré sur l'appareil, stocké chiffré par Synapse, rendu
    // par /sync, déchiffré ici. C'est le seul test du dépôt qui l'exerce.
    const reçu = await vi.waitFor(() => {
      const trouvé = messages(session, salon).find((event) => event.getId() === event_id);
      if (!trouvé) throw new Error(`le message ${event_id} n'est pas encore revenu par /sync`);
      return trouvé;
    }, ATTENTE);

    expect(reçu.getContent().body).toBe(texte);
    // ce que Synapse a stocké est `m.room.encrypted`, pas le texte.
    expect(reçu.getWireType()).toBe("m.room.encrypted");
    expect(JSON.stringify(reçu.getWireContent())).not.toContain("parc");
  });
});

describe("Fumée — la session se rouvre sans réseau", () => {
  it("rouvre après « rechargement » et retrouve l'historique déchiffré", async () => {
    const avant = messages(session, salon).length;
    expect(avant).toBeGreaterThan(0);
    session.client.stopClient();

    // Rechargement de page : objets neufs, même disque. Aucun jeton n'est fourni —
    // si `restoreSession` ne relit pas les credentials, il n'y a pas de session.
    const rechargée = await restoreSession({ homeserverUrl: HOMESERVER, indexedDB: disque });
    expect(rechargée, "la session ne s'est pas rouverte : n'est pas tenue").not.toBeNull();

    try {
      expect(rechargée!.client.getUserId()).toBe(compte.userId);
      // Le même appareil, donc les mêmes clés Megolm : l'historique reste lisible.
      // Un device_id neuf le rendrait indéchiffrable — c'est ce que C4 évite.
      expect(rechargée!.client.getDeviceId()).toBe(session.client.getDeviceId());
      const après = await vi.waitFor(() => {
        const timeline = messages(rechargée!, salon);
        if (timeline.length < avant) throw new Error("l'historique n'est pas encore rechargé");
        return timeline;
      }, ATTENTE);
      expect(après.at(-1)!.getContent().body).toMatch(/rendez-vous au parc/);
    } finally {
      rechargée!.client.stopClient();
    }
  });

  it("sans session locale, rend null plutôt que d'échouer", async () => {
    // Un disque vierge, c'est un premier lancement : le shard UI doit
    // recevoir le signal « passe par l'OIDC », pas une exception.
    expect(await restoreSession({ homeserverUrl: HOMESERVER, indexedDB: new IDBFactory() })).toBeNull();
  });
});
