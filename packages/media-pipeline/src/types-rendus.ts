/**
 * **la liste close des types rendus, et la résolution qui y mène.**
 *
 * Octets → type : aucun DOM, donc ce module vit ici et non dans le shard. Le shard en
 * consomme le verdict, il ne le recalcule pas.
 *
 * Pourquoi une liste close plutôt qu'un filtre : `info.mimetype` est protégé par Megolm,
 * donc **non falsifiable par le serveur et parfaitement falsifiable par l'expéditeur**.
 * Le chiffrement ne protège rien ici — c'est la liste qui protège, et elle s'écrit par
 * défaut de refus : ce qui n'est pas nommé est refusé.
 */

/** Le type déclaré, sans ses paramètres et en minuscules : `Video/MP4; codecs=avc1` → `video/mp4`. */
const normaliser = (valeur: string): string => (valeur.split(";")[0] ?? "").trim().toLowerCase();

/**
 * les types que l'application accepte de **rendre**. Tout le reste se
 * télécharge, ne s'affiche pas.
 *
 * L'audio a sa ligne parce que le shard rend trois `msgtype`, pas deux : `m.audio` passe
 * par la même fonction de téléchargement et le même `URL.createObjectURL` que les deux
 * autres. `audio/ogg` est notre format de sortie unique ; les quatre autres sont
 * ce qu'un client tiers ou un pont peut envoyer.
 */
export const TYPES_RENDUS: Readonly<Record<"video" | "image" | "audio", readonly string[]>> = {
  video: ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"],
  image: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"],
  audio: ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/webm", "audio/wav"],
};

const RENDUS = new Set(Object.values(TYPES_RENDUS).flat());

/** le prédicat de la liste close. `application/octet-stream` en est absent, et c'est le point. */
export function estRendable(type: string | undefined): boolean {
  return type !== undefined && RENDUS.has(normaliser(type));
}

/**
 * Ce qu'il faut lire du clair pour renifler : 64 octets suffisent aux six signatures
 * ci-dessous, et un `DocType` EBML tient largement dedans.
 */
export const TAILLE_SNIFF = 64;

const ascii = (octets: Uint8Array, debut: number, longueur: number): string =>
  String.fromCharCode(...octets.subarray(debut, debut + longueur));

const commence = (octets: Uint8Array, ...signature: number[]): boolean =>
  signature.every((octet, rang) => octets[rang] === octet);

/**
 * **le repli quand l'événement ne déclare rien** (vieux clients, ponts).
 *
 * Reniflement des octets d'en-tête du **clair**, jamais du chiffré : un blob chiffré est
 * du bruit, il n'a pas de signature. Rend `undefined` quand rien ne correspond — et
 * `undefined` est un état d'échec explicite, pas un repli vers un type par défaut.
 */
export function typeSniffe(octets: Uint8Array): string | undefined {
  if (octets.length < 12) return undefined;

  // ISO BMFF — `ftyp` à l'offset 4, la marque de conteneur juste derrière. MP4, MOV et
  // AVIF partagent cette boîte : c'est la marque qui les sépare, pas la signature.
  if (ascii(octets, 4, 4) === "ftyp") {
    const marque = ascii(octets, 8, 4);
    if (marque === "qt  ") return "video/quicktime";
    if (marque === "avif" || marque === "avis") return "image/avif";
    return "video/mp4";
  }

  // EBML — Matroska et WebM ont le même en-tête ; seul le `DocType` les distingue, et il
  // est en clair dans les premiers octets.
  if (commence(octets, 0x1a, 0x45, 0xdf, 0xa3)) {
    return ascii(octets, 0, Math.min(octets.length, TAILLE_SNIFF)).includes("webm")
      ? "video/webm"
      : "video/x-matroska";
  }

  if (commence(octets, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (commence(octets, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (ascii(octets, 0, 3) === "GIF") return "image/gif";
  if (ascii(octets, 0, 4) === "RIFF" && ascii(octets, 8, 4) === "WEBP") return "image/webp";

  return undefined;
}

/**
 * L'issue de la résolution. `octets-requis` n'est pas un échec : c'est la demande de
 * lire les premiers octets du clair, faute de type déclaré.
 */
export type Resolution =
  | { rendable: true; type: string }
  | { rendable: false; motif: "hors-liste" | "inconnu" | "octets-requis" };

/**
 * la résolution, dans son ordre : le champ déclaré, puis les octets.
 *
 * **Un type déclaré hors liste ne redescend pas au reniflement.** C'est délibéré : un
 * expéditeur qui annonce `image/svg+xml` a dit ce qu'il voulait qu'on rende, et lui
 * chercher une seconde chance dans ses propres octets reviendrait à lui en donner deux.
 * Le fichier reste téléchargeable — ce qui est refusé, c'est de le **rendre**.
 */
export function resoudreType(declare?: string, octets?: Uint8Array): Resolution {
  if (declare !== undefined && normaliser(declare) !== "" && normaliser(declare) !== "application/octet-stream") {
    return estRendable(declare)
      ? { rendable: true, type: normaliser(declare) }
      : { rendable: false, motif: "hors-liste" };
  }

  if (octets === undefined) return { rendable: false, motif: "octets-requis" };

  const sniffe = typeSniffe(octets);
  return sniffe !== undefined && estRendable(sniffe)
    ? { rendable: true, type: sniffe }
    : { rendable: false, motif: "inconnu" };
}
