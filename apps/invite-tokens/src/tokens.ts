import { createHash, randomBytes } from "node:crypto";

/**
 * 256 bits tirés d'un CSPRNG. `base64url` : rien à échapper dans une URL,
 * donc rien qui se perde à la copie d'un lien.
 *
 * Pas de jeton auto-porteur signé (JWT) : un JWT ne se révoque pas, et exige
 * la révocation immédiate. Un opaque adossé à une ligne se révoque en une écriture.
 */
export const mintToken = (): string => randomBytes(32).toString("base64url");

/**
 * le token n'est jamais stocké en clair : une base qui fuite ne donne
 * aucun lien utilisable.
 *
 * SHA-256 nu, et non bcrypt/argon2 : le secret a 256 bits d'entropie tirés d'un CSPRNG,
 * il n'a ni dictionnaire ni motif à protéger, et un KDF lent sur un chemin non
 * authentifié ferait de un levier de déni de service au lieu d'une défense.
 */
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
