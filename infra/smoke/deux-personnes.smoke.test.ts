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
 * distincts n'y est jamais exercé, alors que REQ-COR-07 le restreint aux appareils
 * signés par leur propriétaire (D-08, mode `OnlySignedDevicesIsolationMode`).
 *
 * Si ce fichier échoue, la question n'est pas « le test est-il bon » mais « deux
 * personnes peuvent-elles se parler ».
 */

const ATTENTE = { timeout: 30_000, interval: 250 };

let alice: { compte: Account; session: Session };
let bob: { compte: Account; session: Session };

/**
 * `signe: false` saute `setupRecoveryKey()` et rend donc un appareil **non signé**
 * par son propriétaire. C'est un état que le parcours produit n'autorise pas
 * (REQ-COR-06 rend le bootstrap obligatoire à l'inscription) — il ne sert qu'à
 * fabriquer l'intrus du test négatif.
 */
async function ouvrir(
  prefixe: string,
  { signe = true }: { signe?: boolean } = {},
): Promise<{ compte: Account; session: Session }> {
  const compte = await registerAccount(uniqueLocalpart(prefixe));
  const disque = new IDBFactory(); // un appareil distinct = un disque distinct
  await semer(disque, compte);
  const session = await restoreSession({ homeserverUrl: HOMESERVER, indexedDB: disque });
  if (!session) throw new Error(`session ${prefixe} non ouverte`);

  // REQ-COR-06 — le parcours d'inscription impose la clé de récupération, qui amorce
  // le cross-signing. C'est elle qui rend l'appareil signé, donc digne des clés
  // Megolm (D-08) : le produit n'a besoin de rien d'autre pour que deux personnes
  // se parlent.
  if (signe) await session.setupRecoveryKey();
  return { compte, session };
}

beforeAll(async () => {
  alice = await ouvrir("alice");
  bob = await ouvrir("bob");
});

describe("REQ-COR-07 — un appareil non signé reste illisible (D-08)", () => {
  it("le message d'un appareil que son propriétaire n'a pas signé arrive chiffré et le reste", async () => {
    // L'intrus est le **destinataire** : Dave n'a pas amorcé son cross-signing, son
    // appareil ne porte donc aucune signature de son propriétaire. C'est la forme
    // qu'a un appareil injecté côté serveur — celui contre lequel REQ-INF-11 protège,
    // et la protection que le TOFU par appareil aurait cédée.
    //
    // Carol, elle, est signée : sous D-08 un expéditeur sans identité cross-signing
    // ne peut pas chiffrer du tout (« Encryption failed because cross-signing is not
    // set up on your account »), le test ne prouverait donc rien de la réception.
    const carol = await ouvrir("carol");
    const dave = await ouvrir("dave", { signe: false });

    const { room_id } = await createDirectMessage(carol.session, dave.compte.userId);
    await dave.session.client.joinRoom(room_id);
    await vi.waitFor(
      () => expect(dave.session.client.getRoom(room_id)?.getMyMembership()).toBe("join"),
      ATTENTE,
    );

    await sendText(carol.session, room_id, `illisible ${Date.now()}`);

    // Ce test épingle la garantie que D-08 **conserve** : la confiance se porte sur
    // l'identité, donc un appareil sans signature de son propriétaire ne reçoit rien.
    // C'est ce que le TOFU par appareil aurait cédé, et la raison pour laquelle
    // l'arbitrage l'a refusé.
    //
    // S'il passe au rouge, ce n'est pas lui qu'il faut réparer : c'est que le mode
    // d'isolation a été desserré, et ça se décide au PM.
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

    // Aucun geste de vérification ici, et c'est tout l'enjeu : sous D-08, la
    // signature posée par `setupRecoveryKey()` à l'inscription suffit. La version
    // précédente de ce test appelait `setDeviceVerified()` des deux côtés — elle
    // simulait une UI que personne n'avait en charge, et masquait le fait que le
    // produit livré ne laissait pas deux personnes se parler.
    const texte = `bonjour Bob ${Date.now()}`;
    await sendText(alice.session, room_id, texte);

    // Le point qui décide de tout : Bob a-t-il reçu la clé de session ?
    // REQ-COR-07 la réserve aux appareils signés par leur propriétaire.
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
