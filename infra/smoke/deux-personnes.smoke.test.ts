import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { restoreSession, type Session } from "@tacita/client-core";
import { createDirectMessage, createGroupChat, messages, sendText } from "@tacita/messaging";

import { HOMESERVER, registerAccount, uniqueLocalpart, type Account } from "./harness";

/**
 * Deux personnes réelles, deux appareils, un salon chiffré.
 *
 * Ce que la cible existante ne couvre pas : elle valide un utilisateur qui se parle
 * à lui-même — même appareil, mêmes clés. Le partage de clés Megolm entre appareils
 * distincts n'a jamais été exercé, alors que REQ-COR-07 verrouille
 * `globalBlacklistUnverifiedDevices` : les clés ne sont **jamais** partagées avec un
 * appareil non vérifié.
 *
 * Si ce fichier échoue, la question n'est pas « le test est-il bon » mais « deux
 * personnes peuvent-elles se parler ».
 */

const ATTENTE = { timeout: 30_000, interval: 250 };

let alice: { compte: Account; session: Session };
let bob: { compte: Account; session: Session };

async function ouvrir(prefixe: string): Promise<{ compte: Account; session: Session }> {
  const compte = await registerAccount(uniqueLocalpart(prefixe));
  const disque = new IDBFactory(); // un appareil distinct = un disque distinct
  await semer(disque, compte);
  const session = await restoreSession({ homeserverUrl: HOMESERVER, indexedDB: disque });
  if (!session) throw new Error(`session ${prefixe} non ouverte`);

  // REQ-COR-06 — le parcours d'inscription impose la clé de récupération, qui
  // amorce le cross-signing. Sans elle, l'appareil n'est même pas signé par son
  // propre propriétaire : on testerait un cas que le produit n'autorise pas.
  await session.setupRecoveryKey();
  return { compte, session };
}

beforeAll(async () => {
  alice = await ouvrir("alice");
  bob = await ouvrir("bob");
});

describe("REQ-COR-07 — sans vérification préalable, rien n'est lisible", () => {
  it("le message d'un appareil non vérifié arrive chiffré et le reste", async () => {
    // Paire neuve : les autres tests marquent les appareils vérifiés, et cet
    // état-là est justement ce qu'on veut ne pas avoir ici.
    const carol = await ouvrir("carol");
    const dave = await ouvrir("dave");

    const { room_id } = await createDirectMessage(carol.session, dave.compte.userId);
    await dave.session.client.joinRoom(room_id);
    await vi.waitFor(
      () => expect(dave.session.client.getRoom(room_id)?.getMyMembership()).toBe("join"),
      ATTENTE,
    );

    await sendText(carol.session, room_id, `illisible ${Date.now()}`);

    // Ce test épingle une **limitation connue et voulue**, pas un bug : REQ-COR-07
    // dit « jamais » et l'applique. Tant qu'aucun parcours de vérification n'existe
    // (spec 11), deux utilisateurs ne peuvent pas communiquer.
    //
    // S'il passe au rouge, ce n'est pas lui qu'il faut réparer : c'est que
    // quelqu'un a affaibli REQ-COR-07, et ça se décide au PM.
    const échec = await vi.waitFor(() => {
      const chiffré = dave.session.client
        .getRoom(room_id)
        ?.getLiveTimeline()
        .getEvents()
        .find((event) => event.isDecryptionFailure());
      if (!chiffré) throw new Error("l'événement n'est pas encore arrivé chez Dave");
      return chiffré;
    }, ATTENTE);

    expect(échec.isDecryptionFailure()).toBe(true);
    carol.session.client.stopClient();
    dave.session.client.stopClient();
  });
});

describe("Fumée — deux personnes distinctes dans un salon chiffré", () => {
  it("un DM créé par l'une est rejoint par l'autre", async () => {
    const { room_id } = await createDirectMessage(alice.session, bob.compte.userId);

    await bob.session.client.joinRoom(room_id);
    await vi.waitFor(
      () => expect(bob.session.client.getRoom(room_id)?.getMyMembership()).toBe("join"),
      ATTENTE,
    );

    // REQ-MSG-02 — le salon doit être chiffré pour les deux, pas seulement pour
    // celle qui l'a créé.
    await vi.waitFor(
      async () => expect(await bob.session.isEncrypted(room_id)).toBe(true),
      ATTENTE,
    );
  });

  it("Alice écrit, Bob déchiffre — le vrai test du partage de clés Megolm", async () => {
    const { room_id } = await createDirectMessage(alice.session, bob.compte.userId);
    await bob.session.client.joinRoom(room_id);
    await vi.waitFor(
      () => expect(bob.session.client.getRoom(room_id)?.getMyMembership()).toBe("join"),
      ATTENTE,
    );

    // Diagnostic : REQ-COR-07 refuse de chiffrer pour un appareil non vérifié. On
    // simule ici ce que la vérification interactive ferait — sans elle, le message
    // part illisible. C'est le geste qu'aucune spec n'attribue à personne.
    await alice.session.client
      .getCrypto()!
      .setDeviceVerified(bob.compte.userId, bob.compte.deviceId, true);
    await bob.session.client
      .getCrypto()!
      .setDeviceVerified(alice.compte.userId, alice.compte.deviceId, true);

    const texte = `bonjour Bob ${Date.now()}`;
    await sendText(alice.session, room_id, texte);

    // Le point qui décide de tout : Bob a-t-il reçu la clé de session ?
    // REQ-COR-07 interdit de la partager avec un appareil non vérifié.
    const reçu = await vi.waitFor(() => {
      const trouvé = messages(bob.session, room_id).find(
        (event) => event.getContent().body === texte,
      );
      if (!trouvé) throw new Error("le message n'est pas encore arrivé chez Bob");
      return trouvé;
    }, ATTENTE);

    expect(reçu.isDecryptionFailure(), "Bob voit un message illisible").toBe(false);
    expect(reçu.getContent().body).toBe(texte);
    expect(reçu.getSender()).toBe(alice.compte.userId);
  });

  it("Bob répond, Alice déchiffre — dans les deux sens", async () => {
    const { room_id } = await createGroupChat(alice.session, "salon de démonstration", [
      bob.compte.userId,
    ]);
    await bob.session.client.joinRoom(room_id);
    await vi.waitFor(
      () => expect(bob.session.client.getRoom(room_id)?.getMyMembership()).toBe("join"),
      ATTENTE,
    );

    const réponse = `bien reçu Alice ${Date.now()}`;
    await sendText(bob.session, room_id, réponse);

    const chezAlice = await vi.waitFor(() => {
      const trouvé = messages(alice.session, room_id).find(
        (event) => event.getContent().body === réponse,
      );
      if (!trouvé) throw new Error("la réponse n'est pas encore arrivée chez Alice");
      return trouvé;
    }, ATTENTE);

    expect(chezAlice.isDecryptionFailure()).toBe(false);
    expect(chezAlice.getSender()).toBe(bob.compte.userId);
  });
});

/** Même semis que la cible de session : le jeton vient du secret partagé. */
function semer(indexedDB: IDBFactory, account: Account): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("tacita-session", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("credentials");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const transaction = open.result.transaction("credentials", "readwrite");
      transaction
        .objectStore("credentials")
        .put(
          {
            accessToken: account.accessToken,
            userId: account.userId,
            deviceId: account.deviceId,
          },
          "current",
        );
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? new Error("transaction IndexedDB avortée"));
    };
  });
}
