import { createHmac, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";

/**
 * Ce qu'il faut pour parler à une pile réelle. Rien de métier ici : la cible teste
 * nos packages, pas ce fichier.
 */

/** Synapse en direct : l'API d'admin est bloquée au proxy (REQ-INF-11). */
export const HOMESERVER = process.env.SMOKE_HOMESERVER ?? "http://127.0.0.1:8008";

export interface Account {
  userId: string;
  deviceId: string;
  accessToken: string;
}

/**
 * Crée un compte et rend un jeton d'accès, par le secret partagé de REQ-INF-04.
 *
 * Pas par le flux OIDC : il ne fonctionne pas en local (trois causes documentées
 * dans infra/README.md), et l'arbitrage PM du 03/08/2026 a tranché qu'un tronçon
 * bloqué ne prend pas en otage la validation de sept modules. Ce que cette cible
 * ne couvre donc **pas** : `initSession()` et le jeton `m.login.token`. Le ticket
 * OIDC les couvrira sous un describe REQ-INF-09.
 */
export async function registerAccount(localpart: string): Promise<Account> {
  const endpoint = `${HOMESERVER}/_synapse/admin/v1/register`;
  const password = `${localpart}-pass-123456`;

  const { nonce } = (await (await fetch(endpoint)).json()) as { nonce: string };
  const mac = createHmac("sha1", requireSharedSecret())
    .update([nonce, localpart, password, "notadmin"].join("\0"))
    .digest("hex");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nonce, username: localpart, password, admin: false, mac }),
  });
  if (!response.ok) {
    throw new Error(`création du compte ${localpart} refusée : ${response.status}`);
  }

  const body = (await response.json()) as {
    user_id: string;
    device_id: string;
    access_token: string;
  };
  return { userId: body.user_id, deviceId: body.device_id, accessToken: body.access_token };
}

function requireSharedSecret(): string {
  const secret = process.env.SYNAPSE_REGISTRATION_SHARED_SECRET;
  if (!secret) {
    throw new Error(
      "SYNAPSE_REGISTRATION_SHARED_SECRET manquant : lancer via `npm run smoke`, " +
        "qui charge infra/.env (voir infra/smoke/README.md)",
    );
  }
  return secret;
}

/** Nom public du déploiement, celui que porte le certificat et `public_baseurl`. */
export const SERVER_NAME = process.env.SERVER_NAME ?? "chat.example.org";

/**
 * Un GET sur le proxy public, sans suivre les redirections.
 *
 * `fetch` ne convient pas : le nom public ne résout nulle part sur la machine de
 * dev, et le certificat est auto-signé. `node:https` accepte les deux réglages —
 * on vise 127.0.0.1 en annonçant le vrai nom (SNI + en-tête `Host`).
 *
 * `rejectUnauthorized: false` ne masque rien de ce qui est testé : la confiance TLS
 * qui compte ici est celle de **Synapse envers Keycloak**, à l'intérieur du réseau,
 * pas celle de ce client envers le proxy.
 */
export function getViaProxy(path: string): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        host: "127.0.0.1",
        port: 443,
        path,
        servername: SERVER_NAME,
        headers: { Host: SERVER_NAME },
        rejectUnauthorized: false,
      },
      (response) => {
        response.resume(); // le corps ne nous intéresse pas, mais il faut le drainer
        resolve({ status: response.statusCode ?? 0, location: response.headers.location ?? null });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/** Un localpart neuf par exécution : Synapse refuse de recréer un compte. */
export const uniqueLocalpart = (prefix: string): string =>
  `${prefix}${randomUUID().replace(/-/g, "").slice(0, 10)}`;

