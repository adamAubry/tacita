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
 * REQ-MED-08 — rejet explicite d'un blob dont l'empreinte ne correspond pas.
 * REQ-MED-10 — l'erreur ne porte ni clé, ni octets, ni URL : elle est destinée aux logs.
 */
export class MediaIntegrityError extends Error {
  constructor() {
    super("empreinte SHA-256 du média invalide : blob rejeté sans déchiffrement");
    this.name = "MediaIntegrityError";
  }
}

/** Base64 non paddé, par tranches : `String.fromCharCode(...)` sature la pile sur un blob. */
function base64(bytes: Bytes): string {
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
 * REQ-MED-01 — chiffrement avant tout contact avec le réseau : le serveur et S3 ne
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

/** REQ-MED-08 — l'empreinte est vérifiée *avant* de déchiffrer, pas après. */
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
