import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it } from "vitest";

import { restoreSession, type Session } from "@tacita/client-core";
import { createDirectMessage, messages, sendText } from "@tacita/messaging";

import {
  HOMESERVER,
  registerAccount,
  semerCredentials,
  uniqueLocalpart,
  type Account,
} from "./harness";

/**
 * Deux `MatrixClient` sur le même IndexedDB.
 *
 * Question ouverte le 04/08/2026, escaladée, et qui n'avait laissé **aucune trace
 * écrite** — ni arbitrage, ni ticket, ni commentaire. Mesurée ici plutôt que débattue.
 *
 * Pourquoi elle compte : `initSession`/`restoreSession` n'ont aucun garde contre une
 * seconde ouverture, et un shard React en mode strict monte ses effets **deux fois**.
 * L'onboarding de `apps/web` appellera donc `restoreSession` deux fois au premier rendu,
 * que le développeur le veuille ou non.
 *
 * **Réponse mesurée : rien ne casse.** La seconde session s'ouvre sans erreur, garde le
 * même `device_id`, voit les messages de la première et peut envoyer. Aucun garde n'est
 * donc requis dans `client-core` — et en ajouter un ferait échouer un cas qui fonctionne.
 *
 * ⚠️ **Limite de la mesure, à ne pas gommer.** Elle tourne sous `fake-indexeddb` dans
 * Node, pas dans un vrai navigateur. Les sémantiques de verrouillage et de
 * `versionchange` d'un IndexedDB réel diffèrent, et le magasin de la crypto Rust est un
 * IndexedDB distinct. Le cas React strict vit précisément dans un navigateur : ce test
 * réduit le risque, il ne l'annule pas. À rejouer quand le shard existera.
 */

const ATTENTE = { timeout: 30_000, interval: 250 };

let compte: Account;
const disque = new IDBFactory(); // un seul disque, partagé — c'est tout le sujet

let première: Session;
let seconde: Session | null = null;
let erreurSeconde: unknown;

beforeAll(async () => {
  compte = await registerAccount(uniqueLocalpart("double"));
  await semerCredentials(disque, compte);

  première = (await restoreSession({ homeserverUrl: HOMESERVER, indexedDB: disque }))!;
  await première.setupRecoveryKey();

  // La seconde ouverture, sur le même disque, sans que la première soit fermée.
  try {
    seconde = await restoreSession({ homeserverUrl: HOMESERVER, indexedDB: disque });
  } catch (cause) {
    erreurSeconde = cause;
  }
});

describe("deux sessions sur le même store IndexedDB coexistent", () => {
  it("la seconde ouverture n'échoue pas et garde le même appareil", () => {
    expect(erreurSeconde, "la seconde ouverture a levé").toBeUndefined();
    expect(seconde).not.toBeNull();
    expect(seconde!.client.getDeviceId()).toBe(compte.deviceId);
  });

  it("les deux voient le même message chiffré, et les deux peuvent écrire", async () => {
    const pair = await registerAccount(uniqueLocalpart("pair"));
    const { room_id } = await createDirectMessage(première, pair.userId);

    const texte = `deux-sessions ${Date.now()}`;
    await sendText(première, room_id, texte);

    const chezLaPremière = await attendre(() =>
      messages(première, room_id).find((event) => event.getContent().body === texte),
    );
    expect(chezLaPremière, "la première ne se relit pas").toBeDefined();
    expect(chezLaPremière!.isDecryptionFailure()).toBe(false);

    // Le point qui décide : même store, mêmes clés. Les deux clients ne se marchent pas
    // dessus — si un jour ils le font, ce test le dira avant le développeur du shard.
    const chezLaSeconde = await attendre(() =>
      messages(seconde!, room_id).find((event) => event.getContent().body === texte),
    );
    expect(chezLaSeconde, "la seconde session ne voit pas le message").toBeDefined();
    expect(chezLaSeconde!.isDecryptionFailure(), "la seconde ne déchiffre pas").toBe(false);

    await expect(sendText(seconde!, room_id, `retour ${Date.now()}`)).resolves.toBeDefined();
  });
});

/** Attente locale : ce fichier ne dépend pas d'un utilitaire de test pour boucler. */
async function attendre<T>(lire: () => T | undefined): Promise<T | undefined> {
  const fin = Date.now() + ATTENTE.timeout;
  while (Date.now() < fin) {
    const valeur = lire();
    if (valeur) return valeur;
    await new Promise((r) => setTimeout(r, ATTENTE.interval));
  }
  return undefined;
}
