/**
 * Schéma `EncryptedFile` de la spec Matrix (extensions aux msgtypes `m.room.message`).
 * Redéfini ici : le SDK ne l'exporte pas depuis sa racine, et un import de sous-chemin
 * interne casserait à la prochaine réorganisation de ses fichiers.
 */
export interface EncryptedFile {
  /** URL `mxc://` du blob chiffré. */
  url: string;
  key: { alg: string; key_ops: string[]; kty: string; k: string; ext: boolean };
  /** Bloc compteur AES-CTR 128 bits, base64 non paddé. */
  iv: string;
  hashes: { [algorithm: string]: string };
  /** Toujours `v2`. */
  v: string;
}

/** Ce que l'événement transporte, moins l'URL que seul l'upload connaît. */
export type FileKeys = Omit<EncryptedFile, "url">;

/** TS 5.7 paramètre `Uint8Array` par son buffer ; `Blob` et `fetch` refusent le partagé. */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Schéma `EncryptedFile` v2 : AES-CTR 256 bits, compteur sur les 64 bits de poids faible. */
const AES = { name: "AES-CTR", length: 256 } as const;
const COUNTER_BITS = 64;

/**
 * rejet explicite d'un blob dont l'empreinte ne correspond pas.
 * l'erreur ne porte ni clé, ni octets, ni URL : elle est destinée aux logs.
 */
export class MediaIntegrityError extends Error {
  constructor() {
    super("empreinte SHA-256 du média invalide : blob rejeté sans déchiffrement");
    this.name = "MediaIntegrityError";
  }
}

/**
 * Base64 non paddé, par tranches : `String.fromCharCode(...)` sature la pile sur un blob.
 *
 * Exporté pour `blocs.ts`, qui en tenait une copie identique — même découpe, même
 * `0x8000`, même retrait du padding. Deux exemplaires dans le même paquet, dont un seul
 * aurait été corrigé le jour où il aurait fallu.
 */
export function base64(bytes: Bytes): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/=+$/, "");
}

const unbase64 = (value: string): Bytes =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const sha256 = async (subtle: SubtleCrypto, data: Bytes): Promise<string> =>
  base64(new Uint8Array(await subtle.digest("SHA-256", data)));

/**
 * La spec Matrix décrit ces empreintes en base64 **non paddé**, mais elle décrit ce que
 * les clients devraient émettre, pas ce qu'ils émettent : un `=` final suffirait sinon à
 * faire rejeter un média parfaitement valide envoyé par un autre client. La comparaison
 * se fait donc sur une forme normalisée des deux côtés.
 */
const unpadded = (value: string): string => value.replace(/=+$/, "");

export interface CryptoEnvironment {
  subtle: SubtleCrypto;
  getRandomValues(bytes: Uint8Array): void;
}

/**
 * chiffrement avant tout contact avec le réseau : le serveur et S3 ne
 * reçoivent qu'un blob opaque, la clé ne quitte l'appareil que dans l'événement chiffré.
 */
export async function encryptAttachment(
  data: Bytes,
  env: CryptoEnvironment,
): Promise<{ ciphertext: Bytes; keys: FileKeys }> {
  const key = await env.subtle.generateKey(AES, true, ["encrypt", "decrypt"]);
  // Les 8 octets de poids faible sont le compteur : il démarre à zéro, seul le préfixe
  // est tiré au hasard.
  const iv = new Uint8Array(16);
  env.getRandomValues(iv.subarray(0, 8));

  const ciphertext = new Uint8Array(
    await env.subtle.encrypt({ name: "AES-CTR", counter: iv, length: COUNTER_BITS }, key, data),
  );

  return {
    ciphertext,
    keys: {
      key: (await env.subtle.exportKey("jwk", key)) as FileKeys["key"],
      iv: base64(iv),
      hashes: { sha256: await sha256(env.subtle, ciphertext) },
      v: "v2",
    },
  };
}

/**
 * la tranche de déchiffrement. 1 MiB : assez grand pour que le coût par
 * appel soit négligeable, assez petit pour que le pic mémoire du clair le soit aussi.
 */
export const TAILLE_TRANCHE = 1024 * 1024;

/**
 * Le compteur AES-CTR **décalé de `blocs` blocs de 16 octets**.
 *
 * C'est toute la raison pour laquelle un déchiffrement par tranches est possible :
 * contrairement au hash, qui exige le fichier entier (`crypto.subtle.digest` est
 * one-shot), CTR n'est pas chaîné — chaque bloc se déchiffre à partir de son seul
 * compteur, donc depuis n'importe quel décalage multiple de 16.
 *
 * Seuls les 64 bits de poids faible comptent (`COUNTER_BITS`), et ils vivent dans les
 * huit derniers octets : le préfixe aléatoire ne bouge pas.
 */
function compteurDecale(iv: Bytes, blocs: number): Bytes {
  const decale = new Uint8Array(iv) as Bytes;
  const vue = new DataView(decale.buffer, decale.byteOffset, decale.byteLength);
  // `BigInt` et pas une addition en nombre flottant : au-delà de 2^53 blocs l'arithmétique
  // ordinaire arrondit en silence, et un compteur faux déchiffre du bruit sans lever.
  vue.setBigUint64(8, BigInt.asUintN(64, vue.getBigUint64(8) + BigInt(blocs)));
  return decale;
}

/** l'empreinte est vérifiée *avant* de déchiffrer, pas après. */
export async function decryptAttachment(
  ciphertext: Bytes,
  keys: FileKeys,
  subtle: SubtleCrypto,
): Promise<Bytes> {
  if ((await sha256(subtle, ciphertext)) !== unpadded(keys.hashes.sha256 ?? "")) {
    throw new MediaIntegrityError();
  }

  const key = await subtle.importKey("jwk", keys.key, AES, false, ["decrypt"]);
  return new Uint8Array(
    await subtle.decrypt(
      { name: "AES-CTR", counter: unbase64(keys.iv), length: COUNTER_BITS },
      key,
      ciphertext,
    ),
  );
}

/**
 * **vérification globale une fois, puis déchiffrement par tranches.**
 *
 * Conforme à à la lettre, et par le mécanisme (a) qu'elle nomme : l'empreinte
 * du chiffré **entier** est vérifiée avant qu'un seul octet ne soit déchiffré. Ce que la
 * découpe change, ce n'est pas la vérification — c'est le clair, qui n'existe plus jamais
 * en entier : une tranche vit le temps d'être écrite, puis disparaît.
 *
 * Sur une vidéo de 400 Mo reçue d'un client tiers, le pic passe d'environ trois fois la
 * taille du fichier — chiffré, clair, Blob — à « le chiffré, plus une tranche ».
 *
 * Le chiffré, lui, reste entier en mémoire, et il n'y a pas d'échappatoire en phase 2 :
 * WebCrypto n'expose aucun hash incrémental. C'est ce que les plafonds de
 * bornent, et ce que le hachage par blocs lèvera.
 */
/**
 * Déchiffre une tranche de chiffré **prise à un décalage aligné sur 16 octets**.
 *
 * Le cœur du déchiffrement par plage, partagé par le téléchargement par tranches
 * et la lecture progressive (mécanisme (b)). Il ne vérifie
 * rien : la vérification appartient à l'appelant, qui sait ce que couvre la tranche.
 */
export async function dechiffrerA(
  tranche: Bytes,
  keys: FileKeys,
  subtle: SubtleCrypto,
  decalage: number,
): Promise<Bytes> {
  if (decalage % 16 !== 0) throw new Error("décalage non aligné : le compteur AES serait faux");
  const key = await subtle.importKey("jwk", keys.key, AES, false, ["decrypt"]);
  return new Uint8Array(
    await subtle.decrypt(
      { name: "AES-CTR", counter: compteurDecale(unbase64(keys.iv), decalage / 16), length: COUNTER_BITS },
      key,
      tranche,
    ),
  ) as Bytes;
}

export async function* decryptAttachmentByChunks(
  ciphertext: Bytes,
  keys: FileKeys,
  subtle: SubtleCrypto,
  taille = TAILLE_TRANCHE,
): AsyncGenerator<Bytes> {
  if ((await sha256(subtle, ciphertext)) !== unpadded(keys.hashes.sha256 ?? "")) {
    throw new MediaIntegrityError();
  }

  const key = await subtle.importKey("jwk", keys.key, AES, false, ["decrypt"]);
  const iv = unbase64(keys.iv);
  // Une tranche entamant un bloc AES à moitié décalerait le compteur d'un cran : la
  // découpe se fait sur des multiples de 16 octets, et la dernière prend ce qui reste.
  const pas = Math.max(16, Math.floor(taille / 16) * 16);

  for (let debut = 0; debut < ciphertext.length; debut += pas) {
    yield new Uint8Array(
      await subtle.decrypt(
        { name: "AES-CTR", counter: compteurDecale(iv, debut / 16), length: COUNTER_BITS },
        key,
        ciphertext.subarray(debut, debut + pas),
      ),
    ) as Bytes;
  }
}
