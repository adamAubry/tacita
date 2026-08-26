/**
 * **Un appel qui ne fait aucun bruit n'est pas un appel.** La bannière dit qui appelle à
 * qui la regarde ; la sonnerie est ce qui fait regarder. Sans elle, décrocher supposait
 * d'avoir les yeux sur l'écran au bon moment, ce qui n'arrive à peu près jamais.
 *
 * Deux octaves d'un motif à deux temps, synthétisées : aucun fichier, donc rien à
 * précacher, rien à télécharger hors ligne, et rien à faire passer par le service worker.
 * `AudioContext` est dans tous les navigateurs de la cible ; les vieux préfixes ne le
 * sont pas et ne sont pas rattrapés — l'absence de son n'empêche pas de décrocher.
 *
 * **Aucune de ces deux API n'est garantie**, et c'est assumé : un contexte audio créé
 * avant la première interaction avec la page démarre suspendu (politique d'autoplay), et
 * `vibrate` n'existe pas sur iOS. Les deux échouent en silence, la bannière reste.
 */

/** Le motif : deux notes, deux fois, puis un silence — la cadence d'un téléphone. */
const MOTIF_MS = 4_000;
const NOTES: readonly { hz: number; debut: number; duree: number }[] = [
  { hz: 660, debut: 0, duree: 0.4 },
  { hz: 550, debut: 0.5, duree: 0.4 },
  { hz: 660, debut: 1.2, duree: 0.4 },
  { hz: 550, debut: 1.7, duree: 0.4 },
];

/** Assez pour être entendu dans une pièce, pas assez pour faire sursauter. */
const VOLUME = 0.12;

type FabriqueAudio = typeof AudioContext | undefined;

/**
 * Démarre la sonnerie et rend de quoi l'arrêter. Appeler l'arrêt deux fois est sans
 * effet : le décrochage et la fin de l'appel peuvent arriver dans n'importe quel ordre.
 */
export function sonner(fabrique: FabriqueAudio = globalThis.AudioContext): () => void {
  let contexte: AudioContext | undefined;
  let boucle: ReturnType<typeof setInterval> | undefined;
  let arrete = false;

  const vibrer = () => {
    try {
      navigator.vibrate?.([400, 200, 400, 2_000]);
    } catch {
      /* refusée par la plateforme : la bannière reste, et elle suffit */
    }
  };

  const jouer = () => {
    if (!contexte || arrete) return;
    const depart = contexte.currentTime;
    for (const note of NOTES) {
      const oscillateur = contexte.createOscillator();
      const gain = contexte.createGain();
      oscillateur.frequency.value = note.hz;
      // Une enveloppe, pas un créneau : une onde coupée net produit un claquement, et
      // c'est ce claquement qu'on entend plutôt que la note.
      gain.gain.setValueAtTime(0, depart + note.debut);
      gain.gain.linearRampToValueAtTime(VOLUME, depart + note.debut + 0.02);
      gain.gain.linearRampToValueAtTime(0, depart + note.debut + note.duree);
      oscillateur.connect(gain).connect(contexte.destination);
      oscillateur.start(depart + note.debut);
      oscillateur.stop(depart + note.debut + note.duree);
    }
    vibrer();
  };

  try {
    if (fabrique) {
      contexte = new fabrique();
      // Suspendu tant que la page n'a pas été touchée. `resume` est refusé dans ce
      // cas — d'où le `catch` : on ne veut pas d'une erreur non gérée pour un son.
      void contexte.resume?.().catch(() => {});
      jouer();
      boucle = setInterval(jouer, MOTIF_MS);
    } else {
      vibrer();
    }
  } catch {
    /* pas d'audio sur cette plateforme */
  }

  return () => {
    if (arrete) return;
    arrete = true;
    if (boucle !== undefined) clearInterval(boucle);
    try {
      navigator.vibrate?.(0);
      void contexte?.close();
    } catch {
      /* rien à fermer */
    }
  };
}
