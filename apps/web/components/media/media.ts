import type { EncryptedFile } from "@tacita/media-pipeline";

/**
 * Ce que le shard lit d'un événement, et **rien de plus**.
 *
 * Un type structurel plutôt qu'un import de `matrix-js-sdk` : la liste close de
 * REQ-UI-02 n'autorise pas le SDK dans `apps/web`, et c'est voulu — le shard consomme
 * les paquets, il ne parle pas Matrix. Un `MatrixEvent` satisfait cette forme sans
 * conversion, et le compilateur le vérifie au point d'appel.
 */
export interface EvenementLu {
  getId(): string | undefined;
  getContent(): unknown;
}

/** Ce que l'UI a besoin de savoir d'une pièce jointe, lu dans l'événement déchiffré. */
export interface Media {
  msgtype: "m.image" | "m.video" | "m.audio" | "m.file";
  /** Nom du fichier. C'est du contenu : il ne part jamais au serveur (spec 08). */
  nom: string;
  fichier: EncryptedFile;
  /** Vignette chiffrée à part, avec sa propre clé. Absente sur audio et fichier. */
  vignette?: EncryptedFile;
  taille?: number;
  dureeMs?: number;
  /** REQ-MED-06 — pics MSC1767, entiers 0–1024. */
  ondes?: number[];
}

const EST_MEDIA = new Set(["m.image", "m.video", "m.audio", "m.file"]);

/**
 * Lit la pièce jointe d'un événement, ou `undefined` si c'en est un de texte.
 *
 * Aucune URL n'est construite ici, et surtout aucune vignette n'est demandée au serveur :
 * il ne saurait pas redimensionner un blob qu'il ne peut pas déchiffrer (interdit n°5).
 * Le déchiffrement passe par `downloadAttachment` du paquet, jamais par un `src` direct.
 */
export function mediaDe(evenement: EvenementLu): Media | undefined {
  const contenu = evenement.getContent() as Record<string, unknown>;
  const msgtype = contenu.msgtype;
  if (typeof msgtype !== "string" || !EST_MEDIA.has(msgtype)) return undefined;

  const fichier = contenu.file as EncryptedFile | undefined;
  if (!fichier?.url) return undefined;

  const info = (contenu.info ?? {}) as Record<string, unknown>;
  const audio = contenu["org.matrix.msc1767.audio"] as
    | { duration?: number; waveform?: number[] }
    | undefined;

  return {
    msgtype: msgtype as Media["msgtype"],
    nom: typeof contenu.body === "string" ? contenu.body : "",
    fichier,
    vignette: info.thumbnail_file as EncryptedFile | undefined,
    taille: typeof info.size === "number" ? info.size : undefined,
    dureeMs: typeof info.duration === "number" ? info.duration : audio?.duration,
    ondes: audio?.waveform,
  };
}

/** Déchiffre une pièce jointe et rend un blob affichable. Injecté : les composants ne
 *  connaissent ni la session, ni le pipeline — ils sont testables sans les deux. */
export type Telecharger = (fichier: EncryptedFile, mimeType?: string) => Promise<Blob>;

/** Tailles en unités binaires : c'est ce que l'OS affiche, et l'écart déroute. */
export function tailleLisible(octets: number): string {
  const unites = ["o", "Ko", "Mo", "Go"];
  let valeur = octets;
  let rang = 0;
  while (valeur >= 1024 && rang < unites.length - 1) {
    valeur /= 1024;
    rang += 1;
  }
  return `${rang === 0 ? valeur : valeur.toFixed(1)} ${unites[rang]}`;
}

/** `m:ss` — les durées de vocaux dépassent rarement la minute, jamais l'heure. */
export function dureeLisible(ms: number): string {
  const secondes = Math.round(ms / 1000);
  return `${Math.floor(secondes / 60)}:${String(secondes % 60).padStart(2, "0")}`;
}

/**
 * REQ-UIX-17 — les quatre onglets des galeries partagées.
 *
 * `liens` n'est pas un type de message Matrix : c'est un message texte qui **contient**
 * une URL. La détection est volontairement stricte — `https?://` seulement, pas de
 * `www.` deviné : un faux positif transforme une phrase en lien dans une galerie.
 */
export type Onglet = "medias" | "epingles" | "liens" | "fichiers";

const URL_DANS_TEXTE = /https?:\/\/[^\s<>"']+/g;

export function liensDe(evenement: EvenementLu): string[] {
  const contenu = evenement.getContent() as { msgtype?: unknown; body?: unknown };
  if (contenu.msgtype !== "m.text" || typeof contenu.body !== "string") return [];
  return contenu.body.match(URL_DANS_TEXTE) ?? [];
}

/**
 * Répartit l'historique **déjà téléchargé** dans les quatre onglets. Aucun appel réseau :
 * le périmètre est ce que la session a synchronisé, et l'UI le dit (REQ-UIX-17).
 */
export function repartir(
  evenements: EvenementLu[],
  epingles: string[],
): Record<Onglet, EvenementLu[]> {
  const medias: EvenementLu[] = [];
  const fichiers: EvenementLu[] = [];
  const liens: EvenementLu[] = [];

  for (const evenement of evenements) {
    const media = mediaDe(evenement);
    if (media?.msgtype === "m.image" || media?.msgtype === "m.video") medias.push(evenement);
    // Un vocal est un fichier de l'onglet Fichiers : il n'a pas de vignette, et il n'a
    // rien à faire dans une grille de médias.
    else if (media) fichiers.push(evenement);
    else if (liensDe(evenement).length > 0) liens.push(evenement);
  }

  return {
    medias,
    fichiers,
    liens,
    epingles: evenements.filter((evenement) => epingles.includes(evenement.getId() ?? "")),
  };
}
