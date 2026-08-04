import { describe, expect, it } from "vitest";

import { getViaProxy, postViaProxy } from "./harness";

/**
 * REQ-INF-14 — la passerelle push derrière le proxy TLS.
 *
 * Audit des jonctions, entrée n°2. Cette chaîne avait été vérifiée à la main, au curl,
 * en livrant REQ-INF-14 : `infra/tests/push-gateway.test.ts` assère le *contenu des
 * fichiers*, pas le comportement. Par la règle des deux portes, REQ-INF-14 n'avait donc
 * franchi que la première — et une preuve qu'on ne peut pas rejouer n'est pas une preuve,
 * c'est un souvenir.
 *
 * Ce que la surface publique doit être, exactement : la clé publique VAPID, et rien
 * d'autre de la passerelle.
 */

const CLE_PUBLIQUE = process.env.VAPID_PUBLIC_KEY;

describe("REQ-INF-14 — seule la clé publique VAPID sort de la passerelle", () => {
  it("/push/config traverse le proxy TLS et rend la clé du .env", async () => {
    const { status, body } = await getViaProxy("/push/config");

    expect(status, "la passerelle n'est pas jointe à travers le proxy").toBe(200);
    expect(CLE_PUBLIQUE, "VAPID_PUBLIC_KEY absent de l'environnement de fumée").toBeTruthy();

    // La clé rendue est bien celle configurée : sans cette assertion, un 200 sur une
    // réponse vide passerait pour un succès. Le nom du champ est celui de
    // `apps/push-gateway/src/server.ts` (REQ-PSH-03), pas celui qu'on suppose.
    const config = JSON.parse(body) as { vapid_public_key?: string };
    expect(config.vapid_public_key).toBe(CLE_PUBLIQUE);
  });

  it("la clé privée ne fuit jamais avec elle", async () => {
    const { body } = await getViaProxy("/push/config");
    expect(body).not.toContain(process.env.VAPID_PRIVATE_KEY);
    expect(body.toLowerCase()).not.toContain("private");
  });

  it("l'endpoint de notification n'est pas exposé — sinon relais de push ouvert", async () => {
    // `location = /push/config` est un `=` et non un préfixe, justement pour ça.
    // REQ-PSH-01 n'a aucune authentification : atteignable de l'extérieur, la
    // passerelle relaierait le push de n'importe qui.
    //
    // Le POST est essentiel. En GET, ce chemin rend un 404 de toute façon — il part
    // vers Synapse par la route générique `/_matrix` — et l'assertion passerait au vert
    // sans rien prouver de la passerelle.
    const { status, body } = await postViaProxy("/_matrix/push/v1/notify", {
      notification: { event_id: "$sonde:tacita.test", room_id: "!sonde:tacita.test", devices: [] },
    });

    // La signature d'une passerelle atteinte, c'est sa réponse (REQ-PSH-01), pas un
    // code de statut : Synapse peut répondre 400 comme elle peut répondre 200.
    expect(body, "la passerelle push a répondu à une requête venue de l'extérieur").not.toContain(
      "rejected",
    );
    expect(status).not.toBe(200);
  });

  it("rien d'autre de la passerelle ne sort", async () => {
    const { status } = await getViaProxy("/push/");
    expect(status).not.toBe(200);
  });
});
