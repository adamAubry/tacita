import { createHmac, randomUUID } from "node:crypto";

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

/** Un localpart neuf par exécution : Synapse refuse de recréer un compte. */
export const uniqueLocalpart = (prefix: string): string =>
  `${prefix}${randomUUID().replace(/-/g, "").slice(0, 10)}`;

