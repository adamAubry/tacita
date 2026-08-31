import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nginxConf = readFileSync(new URL("../proxy/nginx.conf", import.meta.url), "utf-8");
const realm = JSON.parse(
  readFileSync(new URL("../keycloak/realm-export.json", import.meta.url), "utf-8"),
);
const synapseClient = realm.clients.find((c: { clientId: string }) => c.clientId === "synapse");

describe("REQ-INF-10 — reverse proxy TLS avec routes /_matrix, /livekit/jwt, /livekit/sfu", () => {
  it("écoute en TLS", () => {
    expect(nginxConf).toMatch(/listen\s+443\s+ssl/);
    expect(nginxConf).toMatch(/ssl_certificate\s+\S+/);
    expect(nginxConf).toMatch(/ssl_certificate_key\s+\S+/);
  });

  it("route /_matrix vers Synapse", () => {
    expect(nginxConf).toMatch(/location\s+\/_matrix\s*{[^}]*proxy_pass\s+http:\/\/synapse:8008/s);
  });

  it("route /livekit/jwt vers le service d'autorisation", () => {
    expect(nginxConf).toContain("location /livekit/jwt");
    expect(nginxConf).toContain("lk-jwt-service:8080");
  });

  it("route /livekit/sfu avec upgrade WebSocket", () => {
    const sfuBlock = nginxConf.match(/location\s+\/livekit\/sfu\s*{([^}]*)}/s)?.[1];
    expect(sfuBlock).toBeTruthy();
    expect(sfuBlock).toMatch(/proxy_set_header\s+Upgrade\s+\$http_upgrade/);
    expect(sfuBlock).toMatch(/proxy_set_header\s+Connection\s+\$connection_upgrade/);
  });

  it("REQ-UI-01 — le catch-all `/` sert la PWA, en dernier pour ne masquer aucune route", () => {
    expect(nginxConf).toMatch(/location\s+\/\s*{[^}]*proxy_pass\s+http:\/\/\$web_upstream/s);
    expect(nginxConf).toMatch(/set\s+\$web_upstream\s+web:3000/);
    // Plus basse priorité : le catch-all doit venir après les routes applicatives, sinon
    // il capterait `/_matrix`, `/auth`, `/invite/`… avant elles.
    const catchAll = nginxConf.search(/location\s+\/\s*{/);
    for (const route of ["/_matrix", "/auth", "/invite/", "/livekit/sfu"]) {
      expect(nginxConf.indexOf(`location ${route}`), route).toBeLessThan(catchAll);
    }
  });
});

describe("REQ-INF-09 — le callback OIDC est réellement joignable", () => {
  it("le proxy route le chemin de callback déclaré dans le realm", () => {
    const [redirectUri] = synapseClient.redirectUris;
    const { pathname } = new URL(redirectUri!.replace("${SERVER_NAME}", "example.org"));
    expect(pathname).toBe("/_synapse/client/oidc/callback");
    // Pas de `location /` de repli dans nginx : un préfixe non déclaré = 404.
    expect(nginxConf).toMatch(
      /location\s+\/_synapse\/client\/\s*{[^}]*proxy_pass\s+http:\/\/synapse:8008/s,
    );
  });

  it("defaultClientScopes ne référence que de vrais client scopes Keycloak", () => {
    // `openid` est un paramètre de requête, pas un client scope : Keycloak
    // l'ignore avec un WARN à l'import (vérifié sur 26.7.0).
    expect(synapseClient.defaultClientScopes).not.toContain("openid");
  });
});

describe("REQ-INF-11 — API d'admin de join forcé bloquée au proxy", () => {
  it("/_synapse/admin/ répond 404, placé avant la route /_matrix générique", () => {
    const adminBlockIndex = nginxConf.indexOf("location ^~ /_synapse/admin/");
    const matrixBlockIndex = nginxConf.indexOf("location /_matrix");
    expect(adminBlockIndex).toBeGreaterThan(-1);
    expect(adminBlockIndex).toBeLessThan(matrixBlockIndex);

    const adminBlock = nginxConf.match(/location\s+\^~\s+\/_synapse\/admin\/\s*{([^}]*)}/s)?.[1];
    expect(adminBlock).toMatch(/return\s+404/);
  });
});

describe("REQ-INF-14 — le certificat de dev couvre le nom que Synapse appelle", () => {
  const script = readFileSync(new URL("../proxy/generate-dev-certs.sh", import.meta.url), "utf-8");

  it("le script lit SERVER_NAME dans .env, au lieu de retomber sur localhost", () => {
    // Le README fait lancer le script juste après `cp .env.example .env`, sans rien
    // exporter. Sans cette lecture, le certificat portait `CN=localhost` alors que
    // Synapse appelle `chat.example.org` : un subjectAltName juste, sur le mauvais nom
    // — la panne que REQ-INF-14 venait de corriger, revenue par la porte d'à côté.
    // ponytail: garde par chaîne ; la preuve réelle est le certificat régénéré, que
    // seule la cible de fumée exerce. Celui-ci empêche la régression silencieuse.
    expect(script).toMatch(/ENV_FILE=/);
    expect(script).toMatch(/SERVER_NAME="\$\{SERVER_NAME:-\$\(lire_env SERVER_NAME\)\}"/);
    expect(script).toMatch(/TURN_DOMAIN="\$\{TURN_DOMAIN:-\$\(lire_env TURN_DOMAIN\)\}"/);
  });

  it("subjectAltName reste posé, avec TURN_DOMAIN quand il est défini", () => {
    expect(script).toMatch(/-addext "subjectAltName=/);
    expect(script).toMatch(/\$\{TURN_DOMAIN:\+,DNS:\$TURN_DOMAIN\}/);
  });
});
