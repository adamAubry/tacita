import { describe, expect, it } from "vitest";

import { HOMESERVER } from "./harness";

/**
 * critère de comportement du 03/08/2026 : « une connexion aboutit ». Les
 * tests de config attestent les fichiers, la fumée atteste le comportement.
 *
 * **Réécrit le 25/08/2026** : ce fichier vérifiait que Synapse redirigeait vers le realm
 * Keycloak. Keycloak a été supprimé par D-12 le matin même, et le test est resté rouge
 * derrière — il attestait un comportement que le produit avait cessé de vouloir. Un test
 * qui échoue pour une raison qu'on connaît et qu'on accepte n'atteste plus rien : il
 * apprend seulement à ignorer le rouge.
 */
describe("l'identité est portée par Synapse, et le mot de passe est offert", () => {
  it("`/login` annonce `m.login.password`", async () => {
    const reponse = await fetch(`${HOMESERVER}/_matrix/client/v3/login`);
    const { flows } = (await reponse.json()) as { flows: { type: string }[] };

    expect(reponse.status).toBe(200);
    expect(flows.map((f) => f.type)).toContain("m.login.password");
  });

  it("aucun fournisseur SSO n'est proposé : il n'y en a plus", () => {
    // Le contrôle est ici et pas seulement dans la config : un `m.login.sso` réapparu
    // voudrait dire qu'un fournisseur a été rebranché sans que D-12 soit rouverte.
    return fetch(`${HOMESERVER}/_matrix/client/v3/login`)
      .then((r) => r.json() as Promise<{ flows: { type: string }[] }>)
      .then(({ flows }) => expect(flows.map((f) => f.type)).not.toContain("m.login.sso"));
  });
});
