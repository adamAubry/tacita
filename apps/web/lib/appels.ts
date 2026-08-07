/**
 * REQ-UIX-39 — **l'unique chemin vers un appel.**
 *
 * Le header de conversation (M-D), le bandeau « appel en cours » et le bouton « Appel
 * audio » des Friends interaction buttons (M-G) passent tous par ici. L'exigence dit
 * « même chemin que le header 1:1 » : trois gabarits d'URL recopiés, ce sont trois
 * chemins qui divergeront au premier changement de route.
 *
 * `video` est le point d'entrée choisi, pas un réglage d'appel : la bascule voix↔vidéo
 * appartient à Element Call (E-07).
 */
export const routeAppel = (roomId: string, video = false): string =>
  `/c/${encodeURIComponent(roomId)}/appel${video ? "?video=1" : ""}`;
