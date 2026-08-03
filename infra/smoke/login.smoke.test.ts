import { describe, expect, it } from "vitest";

import { getViaProxy, SERVER_NAME } from "./harness";

/**
 * REQ-INF-09, critère de comportement ajouté le 03/08/2026 par le PM : « une
 * connexion aboutit ». Les tests de config attestent les fichiers, la fumée atteste
 * le comportement — ce fichier est la seconde porte.
 *
 * Il vérifie que Synapse **redirige vers le realm Keycloak**, pas que tout le flux
 * navigateur se déroule : c'est la découverte OIDC qui était cassée, et c'est elle
 * que la redirection prouve. Aller plus loin exigerait de piloter un formulaire
 * HTML, donc un navigateur, donc Playwright — interdit.
 */
describe("REQ-INF-09 — le login OIDC aboutit", () => {
  it("redirige vers le realm Keycloak, découverte OIDC comprise", async () => {
    const retour = encodeURIComponent(`https://${SERVER_NAME}/smoke`);
    const { status, location } = await getViaProxy(
      `/_matrix/client/v3/login/sso/redirect/oidc-keycloak?redirectUrl=${retour}`,
    );

    // Un 503 ici, c'est `OidcDiscoveryError` : Synapse n'a pas pu lire la
    // découverte. C'est l'état dans lequel le dépôt était — config 100 % conforme,
    // et personne ne pouvait se connecter.
    expect(status, "503 = découverte OIDC injoignable, voir README « Login OIDC »").toBe(302);

    const destination = new URL(location!);
    expect(destination.pathname).toContain("/realms/tacita/protocol/openid-connect/auth");
    expect(destination.searchParams.get("client_id")).toBe("synapse");
    // Sans PKCE, un code intercepté est rejouable : le vérifier coûte une ligne.
    expect(destination.searchParams.get("code_challenge_method")).toBe("S256");
  });
});
