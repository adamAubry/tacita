/**
 * Les routes qui portent un identifiant de salon — **en paramètre de requête, pas en
 * segment de chemin**, et c'est le hors-ligne qui l'impose.
 *
 * Mesuré au navigateur le 08/08/2026 : avec `/c/[roomId]`, chaque salon est une route
 * *dynamique*. Next va chercher sa charge RSC sur le réseau à chaque navigation, et le
 * service worker ne peut pas précacher un ensemble d'URL non borné. Hors ligne, le
 * résultat était sans appel — la conversation apparaissait dans la liste, et rester
 * dessus était tout ce qu'on pouvait faire : ni l'ouvrir, ni recharger son lien. REQ-UI-17
 * promet l'historique consultable sans réseau ; il ne l'était qu'avant le premier
 * rechargement.
 *
 * `/c?room=…` est une route **statique** : une seule coquille, précachée avec les autres,
 * et l'identifiant lu côté client. Aucune spec ne fixait la forme de ces URL — elles sont
 * un choix du shard, et celui-ci était incompatible avec une PWA hors ligne.
 */
const avecSalon = (base: string, roomId: string, extra = "") =>
  `${base}?room=${encodeURIComponent(roomId)}${extra}`;

export const routeConversation = (roomId: string, eventId?: string) =>
  avecSalon("/c", roomId, eventId ? `&m=${encodeURIComponent(eventId)}` : "");

export const routeInfos = (roomId: string) => avecSalon("/c/infos", roomId);

/** REQ-UI-19 — l'écran d'appel (M-I). `video=1` distingue vidéo de voix. */
export const routeAppel = (roomId: string, video = false) =>
  avecSalon("/c/appel", roomId, video ? "&video=1" : "");
