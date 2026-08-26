import {
  base64,
  dechiffrerA,
  MediaIntegrityError,
  type Bytes,
  type FileKeys,
} from "./attachments";

/**
 * mécanisme (b) — **le hachage par blocs, et la lecture qu'il autorise.**
 *
 * Le hash global exige le fichier entier avant qu'un seul octet ne soit déchiffré :
 * `crypto.subtle.digest` est one-shot. Pour 60 Mo reçus d'un client tiers, c'est plusieurs
 * secondes avant la première image, et un pic mémoire de trois fois le fichier.
 *
 * Découper le chiffré en blocs et hacher chacun **ne relâche rien** : on passe d'une
 * vérification unique d'un gros bloc à une vérification de chaque octet avant qu'il ne
 * soit servi. C'est un durcissement, et la REQ le dit ainsi.
 *
 * **Le modèle de confiance ne change pas non plus** : la liste des empreintes voyage dans
 * le contenu de l'événement, donc sous Megolm, exactement comme `hashes.sha256`. Ce qui
 * authentifie reste l'enveloppe.
 */

/** 1 MiB : un multiple de 16 — donc alignable sur les blocs AES — et une seconde de vidéo. */
export const TAILLE_BLOC = 1024 * 1024;

/**
 * Le champ qui porte les empreintes, **namespacé et documenté comme nôtre**.
 *
 * Ce n'est pas du Matrix natif et ça ne se présente jamais comme tel : un client tiers ne
 * le connaît pas, l'ignore, et retombe sur `hashes.sha256` — que nous continuons d'écrire.
 * Même discipline que l'accusé « délivré » (interdit n°9).
 */
export const CHAMP_BLOCS = "org.tacita.media.block_sha256";

/** une empreinte par bloc de chiffré, dans l'ordre du fichier. */
export async function hachesParBloc(
  ciphertext: Bytes,
  subtle: SubtleCrypto,
  taille = TAILLE_BLOC,
): Promise<string[]> {
  const haches: string[] = [];
  for (let debut = 0; debut < ciphertext.length; debut += taille) {
    haches.push(
      base64(
        new Uint8Array(await subtle.digest("SHA-256", ciphertext.subarray(debut, debut + taille))),
      ),
    );
  }
  return haches;
}

/** De quoi lire une tranche de chiffré sans le tenir entier en mémoire. */
export interface SourceChiffree {
  taille: number;
  tranche(debut: number, fin: number): Promise<Bytes>;
}

/**
 * **déchiffre une plage, en n'ayant vérifié que ce qu'elle traverse.**
 *
 * Chaque bloc couvert est haché puis comparé **avant** d'être déchiffré ; un bloc invalide
 * lève, et rien de ce bloc ni des suivants n'est rendu. La plage demandée est ensuite
 * découpée dans le clair obtenu.
 *
 * AES-CTR n'est pas chaîné : un bloc se déchiffre depuis son seul compteur, ce qui rend
 * l'accès par plage possible. C'est la même propriété que le téléchargement par tranches
 * de, appliquée cette fois à la lecture.
 */
export async function dechiffrerPlage(
  source: SourceChiffree,
  keys: FileKeys,
  haches: readonly string[],
  subtle: SubtleCrypto,
  debut: number,
  fin: number,
  taille = TAILLE_BLOC,
): Promise<Bytes> {
  const premier = Math.floor(debut / taille);
  const dernier = Math.floor((Math.max(debut, fin) - 1) / taille);

  const morceaux: Bytes[] = [];
  for (let bloc = premier; bloc <= dernier; bloc++) {
    const attendu = haches[bloc];
    // Un bloc dont l'empreinte n'est pas dans la liste ne peut pas être vérifié : il est
    // refusé, jamais servi « faute de mieux ».
    if (attendu === undefined) throw new MediaIntegrityError();

    const depart = bloc * taille;
    const chiffre = await source.tranche(depart, Math.min(depart + taille, source.taille));
    const empreinte = base64(new Uint8Array(await subtle.digest("SHA-256", chiffre)));
    if (empreinte !== attendu) throw new MediaIntegrityError();

    morceaux.push(await dechiffrerA(chiffre, keys, subtle, depart));
  }

  const clair = new Uint8Array(morceaux.reduce((somme, morceau) => somme + morceau.length, 0));
  let position = 0;
  for (const morceau of morceaux) {
    clair.set(morceau, position);
    position += morceau.length;
  }

  const decalage = debut - premier * taille;
  return clair.subarray(decalage, decalage + (fin - debut)) as Bytes;
}
