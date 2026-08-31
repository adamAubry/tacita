import { describe, expect, it } from "vitest";

/**
 * Conformité d'un déploiement **réel** à la posture d'auth des specs.
 *
 * Les autres tests attestent la config (le YAML dit ce qu'il faut) ; la cible de fumée
 * atteste le comportement d'une pile locale. Aucun ne vérifiait que **le serveur en
 * production** applique effectivement cette config — et c'est exactement là que l'écart
 * s'était creusé : un déploiement peut tourner un Synapse par défaut (mot de passe activé,
 * inscription ouverte) pendant que le repo promet l'inverse. Ce fichier ferme ce trou.
 *
 * Opt-in : ne cible aucune URL par défaut, donc ne s'exécute ni dans `npm test` (dossier
 * `smoke/` exclu) ni dans `npm run smoke` sans URL. Le lancer contre un déploiement :
 *
 *   CONFORMANCE_URL=https://chat.spleen.blog npm run conformance
 *
 * Il échoue tant que le serveur ne suit pas les `.md` — c'est le but : la porte manquante
 * entre « le repo est conforme » et « le serveur l'est ».
 */
const BASE = process.env.CONFORMANCE_URL;

const get = async (chemin: string) => {
  const reponse = await fetch(`${BASE}${chemin}`, { redirect: "manual" });
  const texte = await reponse.text();
  return {
    status: reponse.status,
    location: reponse.headers.get("location"),
    json: (() => {
      try {
        return JSON.parse(texte) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })(),
  };
};

describe.skipIf(!BASE)(`Conformité du déploiement ${BASE ?? "(CONFORMANCE_URL absent)"}`, () => {
  it("REQ-INF-09 — auth OIDC seule : le serveur n'offre pas m.login.password", async () => {
    const { status, json } = await get("/_matrix/client/v3/login");
    expect(status).toBe(200);
    const types = ((json?.flows as { type?: string }[]) ?? []).map((f) => f.type);
    // Le cœur de l'écart observé : le live annonçait m.login.password et pas de SSO,
    // soit l'exact inverse de `password_config.enabled: false` + OIDC.
    expect(types, "mot de passe activé → password_config n'est pas false").not.toContain(
      "m.login.password",
    );
    expect(types, "aucun SSO annoncé → OIDC/Keycloak n'est pas câblé").toContain("m.login.sso");
  });

  it("REQ-INF-09 — la redirection SSO atteint réellement le realm Keycloak", async () => {
    const { status, location } = await get(
      "/_matrix/client/v3/login/sso/redirect/oidc-keycloak?redirectUrl=" +
        encodeURIComponent(`${BASE}/`),
    );
    // 404 = pas de provider SSO ; 503 = découverte OIDC injoignable (voir README « Login OIDC »).
    expect(status, "ni 404 (pas d'OIDC) ni 503 (découverte cassée)").toBe(302);
    expect(new URL(location!).pathname).toContain("/realms/tacita/protocol/openid-connect/auth");
  });

  it("REQ-INF-04 — inscription fermée : /register est refusé, pas un flux jouable", async () => {
    const { status, json } = await fetch(`${BASE}/_matrix/client/v3/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).then(async (r) => ({ status: r.status, json: (await r.json()) as Record<string, unknown> }));

    // Ouvert, Synapse rend 401 + un flux d'auth interactive (m.login.dummy) ; fermé, 403
    // M_FORBIDDEN. C'est la différence entre « n'importe qui se crée un compte » et « non ».
    expect(status, "401 = inscription ouverte (flux d'auth interactive rendu)").toBe(403);
    expect(json.errcode).toBe("M_FORBIDDEN");
  });
});
