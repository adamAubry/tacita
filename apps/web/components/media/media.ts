import { CHAMP_BLOCS, SEUILS, type EncryptedFile, type Seuils } from "@tacita/media-pipeline";

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
  /**
   * Le type de la vignette, tel que `thumbnail_info` le déclare.
   *
   * Il n'a pas toujours été le même que celui du média : la vignette est en WebP depuis
   * qu'elle a doublé de côté, et en JPEG là où le navigateur de l'expéditeur ne savait pas
   * l'encoder. Le coder en dur ferait rendre un WebP sous une étiquette JPEG.
   */
  vignetteMime?: string;
  taille?: number;
  /**
   * `info.mimetype`, tel que le pipeline l'écrit (REQ-MED-02).
   *
   * Il n'est pas décoratif : `downloadAttachment` rend des **octets nus**, et le blob
   * qu'on en fabrique n'a que le type qu'on lui donne. Un `<video>` ou un `<audio>` dont
   * la source est un blob `application/octet-stream` n'a aucun moyen de savoir ce qu'il
   * lit — le média est celui d'un conteneur inconnu, et le lecteur refuse ou devine.
   * Absent d'un événement d'un client qui ne le renseigne pas : le repli est alors le
   * type opaque, comme avant.
   */
  mime?: string;
  /**
   * Dimensions de l'original, telles que le pipeline les écrit dans `info.w`/`info.h`
   * (REQ-MED-03). Elles servent à **réserver la boîte** de la vignette avant de l'avoir
   * déchiffrée : sans elles, la tuile n'a pas de hauteur connue et la timeline saute au
   * moment où l'image arrive. Absentes d'un événement envoyé par un autre client qui ne
   * les renseigne pas — d'où le repli.
   */
  largeur?: number;
  hauteur?: number;
  dureeMs?: number;
  /**
   * REQ-MED-08 (b) — les empreintes par bloc, quand l'expéditeur en a écrit.
   *
   * Absentes d'un média envoyé par un client tiers : le champ est à nous, namespacé, et
   * son absence fait simplement retomber sur le chemin d'un seul bloc. Aucune régression
   * d'interop, aucune garantie en moins — c'est la même vérification, en une fois.
   */
  blocs?: string[];
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
    vignetteMime:
      typeof (info.thumbnail_info as Record<string, unknown> | undefined)?.mimetype === "string"
        ? ((info.thumbnail_info as Record<string, string>).mimetype)
        : undefined,
    taille: typeof info.size === "number" ? info.size : undefined,
    mime: typeof info.mimetype === "string" ? info.mimetype : undefined,
    largeur: typeof info.w === "number" ? info.w : undefined,
    hauteur: typeof info.h === "number" ? info.h : undefined,
    dureeMs: typeof info.duration === "number" ? info.duration : audio?.duration,
    blocs: Array.isArray(contenu[CHAMP_BLOCS])
      ? (contenu[CHAMP_BLOCS] as unknown[]).filter((h): h is string => typeof h === "string")
      : undefined,
    ondes: audio?.waveform,
  };
}

/**
 * REQ-MED-15 — le téléchargement par tranches existe-t-il sur ce navigateur ?
 *
 * `showSaveFilePicker` est absent de Firefox et de Safari. Sans lui, le clair doit tenir
 * en mémoire d'un bloc, et c'est le seul cas où le plafond dur s'applique.
 */
export function fluxFichierDisponible(): boolean {
  return typeof (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
}

/**
 * REQ-MED-15 — les plafonds de **cet** appareil.
 *
 * `deviceMemory` est la seule mesure directe, et elle n'existe que sur les navigateurs
 * Chromium. À défaut, `pointer: coarse` : un pointeur grossier est un doigt, donc un
 * téléphone ou une tablette, donc l'appareil où l'onglet meurt sans avertissement. À
 * défaut des deux, le profil de bureau — on ne dégrade pas ce qu'on ne sait pas mesurer,
 * même jurisprudence que le profil réseau de D-04.
 */
export function seuilsAppareil(): Seuils {
  const memoire = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (memoire !== undefined) return memoire <= 4 ? SEUILS.mobile : SEUILS.bureau;
  return globalThis.matchMedia?.("(pointer: coarse)").matches ? SEUILS.mobile : SEUILS.bureau;
}

/**
 * REQ-MED-12 — **ce navigateur-ci sait-il décoder ce type ?**
 *
 * La liste close (paquet, `resoudreType`) dit ce que Tacita accepte de rendre ; elle ne
 * dit pas ce que la plateforme sait lire. Le HEVC d'iOS se lit sur Safari et pas partout
 * sur Chrome de bureau : sans ce contrôle, l'utilisateur reçoit un rectangle noir et en
 * conclut que l'application est cassée.
 *
 * Une chaîne vide est le « non » de `canPlayType` ; `maybe` et `probably` sont deux oui.
 * En rendu serveur il n'y a rien à mesurer, et refuser par défaut afficherait le message
 * d'échec sur le premier rendu de chaque vidéo.
 */
export function navigateurLit(type: string): boolean {
  if (typeof document === "undefined") return true;
  return document.createElement("video").canPlayType(type) !== "";
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
