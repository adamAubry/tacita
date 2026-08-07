/**
 * Les trois adresses de déploiement du shard. Aucune n'est un secret : elles sont
 * publiques dès le premier appel réseau du client. Elles sont ici, ensemble, parce
 * qu'un `process.env` recopié dans trois composants diverge au premier renommage.
 */

/** Homeserver Synapse (spec 01), derrière le proxy TLS. */
export const HOMESERVER = process.env.NEXT_PUBLIC_HOMESERVER_URL ?? "https://chat.example.org";

/**
 * Notre déploiement Element Call, embarqué en widget (spec 10, M-I). Servi sous son
 * propre nom d'hôte par l'overlay RTC (REQ-RTC-08) — le défaut suit `call.<SERVER_NAME>`
 * de `infra/.env.example`, pas une adresse inventée.
 */
export const ELEMENT_CALL_URL =
  process.env.NEXT_PUBLIC_ELEMENT_CALL_URL ?? "https://call.chat.example.org";

/**
 * Passerelle Web Push (spec 03). Elle sert la clé publique VAPID sur `/config` et reçoit
 * les notifications de Synapse ; c'est aussi l'URL que le pusher enregistre côté serveur.
 */
export const PUSH_GATEWAY_URL =
  process.env.NEXT_PUBLIC_PUSH_GATEWAY_URL ?? "https://push.example.org";
