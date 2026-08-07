import type { Session } from "@tacita/client-core";
import { mentionCandidates, messages as listerMessages, messageText } from "@tacita/messaging";

import { PUSH_CONFIG_URL, PUSH_NOTIFY_URL } from "./config";

/**
 * REQ-UI-18 — la chaîne Web Push côté client, de bout en bout.
 *
 * Le service worker n'a **aucun accès aux clés Megolm** : elles vivent dans le store
 * crypto Rust d'une fenêtre. C'est donc lui qui demande l'aperçu à une fenêtre ouverte,
 * par ce protocole — un message, une réponse, rien de conservé nulle part (REQ-UIX-40).
 *
 * Limite assumée, écrite dans les limites connues (M-H) : sans fenêtre ouverte, la
 * notification reste générique. Faire mieux demanderait la crypto Rust dans le service
 * worker ; ce n'est pas un contournement à improviser.
 */
export const TYPE_APERCU = "tacita-apercu";

export interface DemandeApercu {
  type: typeof TYPE_APERCU;
  roomId: string;
  eventId?: string;
}

export interface Apercu {
  expediteur: string;
  texte: string;
}

/**
 * L'aperçu d'un événement, **déchiffré ici** — c'est-à-dire lu dans la timeline que le
 * SDK a déjà déchiffrée pour cette fenêtre.
 *
 * `null` dès que quoi que ce soit manque : événement pas encore synchronisé, clé absente,
 * message sans corps. REQ-UIX-40 : l'appelant affiche alors une notification générique,
 * sans erreur bruyante — un échec de déchiffrement est un cas de fonctionnement normal
 * sur un client chiffré, pas une panne.
 */
export function apercuLocal(session: Session, roomId: string, eventId?: string): Apercu | null {
  try {
    const evenement = listerMessages(session, roomId).find(
      (candidat) => candidat.getId() === eventId,
    );
    const texte = evenement ? messageText(evenement) : "";
    if (!evenement || !texte) return null;

    const auteur = evenement.getSender() ?? "";
    // Le même annuaire que la conversation (REQ-MSG-10) : pas d'accès SDK ici.
    const nom = mentionCandidates(session, roomId).find((c) => c.id === auteur)?.label ?? auteur;
    return { expediteur: nom, texte };
  } catch {
    return null;
  }
}

/** `Notification` n'existe pas partout — un navigateur sans push n'est pas une panne. */
export const pushDisponible = (): boolean =>
  typeof Notification !== "undefined" && "serviceWorker" in globalThis.navigator;

export const permissionPush = (): NotificationPermission | "indisponible" =>
  pushDisponible() ? Notification.permission : "indisponible";

/** REQ-PSH-03 — la clé publique VAPID, servie par la passerelle. */
async function cleVapid(): Promise<string> {
  const reponse = await fetch(PUSH_CONFIG_URL);
  if (!reponse.ok) throw new Error("passerelle push indisponible");
  const { vapid_public_key } = (await reponse.json()) as { vapid_public_key?: string };
  if (!vapid_public_key) throw new Error("passerelle push sans clé VAPID");
  return vapid_public_key;
}

/** base64url → octets : ce que `pushManager.subscribe` attend comme clé serveur. */
function octetsDeBase64Url(valeur: string): Uint8Array {
  const base64 = valeur.replaceAll("-", "+").replaceAll("_", "/");
  const binaire = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  return Uint8Array.from(binaire, (caractere) => caractere.charCodeAt(0));
}

/**
 * REQ-UI-18 — l'abonnement complet : permission, subscription navigateur, pusher Matrix.
 *
 * Rend `false` sur refus de permission, sans lever : c'est un choix, pas une erreur, et
 * les réglages (M-H) en affichent l'état avec son chemin de rattrapage.
 *
 * Les clés de la subscription partent dans `data` du pusher : c'est de là que la
 * passerelle les relit à chaque notification (spec 03), ce qui lui évite une base.
 */
export async function abonnerAuxNotifications(session: Session): Promise<boolean> {
  if (!pushDisponible()) return false;
  if ((await Notification.requestPermission()) !== "granted") return false;

  const enregistrement = await navigator.serviceWorker.ready;
  const cle = await cleVapid();
  const abonnement =
    (await enregistrement.pushManager.getSubscription()) ??
    (await enregistrement.pushManager.subscribe({
      // Exigé par les navigateurs : tout réveil push doit produire une notification
      // visible. C'est aussi ce que nous faisons — y compris quand elle est générique.
      userVisibleOnly: true,
      applicationServerKey: octetsDeBase64Url(cle) as BufferSource,
    }));

  const { endpoint, keys } = abonnement.toJSON() as {
    endpoint: string;
    keys?: { p256dh?: string; auth?: string };
  };

  await session.client.setPusher({
    kind: "http",
    app_id: "org.tacita.web",
    pushkey: endpoint,
    app_display_name: "Tacita",
    device_display_name: session.client.getDeviceId() ?? "web",
    lang: "fr",
    // La spec Matrix laisse `data` libre ; le type du SDK ne connaît que `url`, `format`
    // et `brand`. Les clés de la subscription y sont indispensables — c'est là que la
    // passerelle les relit (spec 03), et sans elles aucun push ne peut être chiffré.
    data: {
      url: PUSH_NOTIFY_URL,
      // REQ-PSH-02 — le format que la passerelle relaie : jamais de contenu, seulement
      // de quoi réveiller ce navigateur.
      format: "event_id_only",
      p256dh: keys?.p256dh,
      auth: keys?.auth,
    } as { url: string; format: string },
    append: false,
  });

  return true;
}
