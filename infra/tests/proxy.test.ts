import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

describe("REQ-INF-10 — setup-certs.sh installe le certificat que nginx lit réellement", () => {
  const chemin = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
  const bacASable = () => {
    const base = mkdtempSync(join(tmpdir(), "tacita-certs-"));
    return { live: join(base, "live"), certs: join(base, "certs") };
  };
  const lancer = (env: Record<string, string>) =>
    execFileSync("sh", [chemin("../proxy/setup-certs.sh")], {
      env: { ...process.env, ...env },
      encoding: "utf-8",
    });

  // certbot écrit sous /etc/letsencrypt/live/<domaine>/, nginx lit proxy/certs/ :
  // la jonction entre les deux n'existait pas, et c'est le seul endroit où une
  // install en production échoue en silence — la pile démarre, sur l'auto-signé.
  // On l'exerce en lançant le script : un `grep` sur son propre texte ne prouve rien ici.
  it("copie le certificat Let's Encrypt quand certbot en a émis un pour SERVER_NAME", () => {
    const { live, certs } = bacASable();
    const domaine = "chat.exemple-test.org";
    // Fixture : un vrai certificat, produit par le script de dev lui-même. Un .pem
    // bidon ne prouverait pas que le fichier posé est lisible par un client TLS.
    mkdirSync(join(live, domaine), { recursive: true });
    execFileSync("sh", [chemin("../proxy/generate-dev-certs.sh")], {
      env: { ...process.env, SERVER_NAME: domaine, CERTS_DIR: join(live, domaine) },
    });

    const sortie = lancer({ SERVER_NAME: domaine, LETSENCRYPT_LIVE: live, CERTS_DIR: certs });

    expect(sortie).toContain("Let's Encrypt");
    // Octet pour octet : c'est bien le certificat de certbot qui est servi, pas un
    // auto-signé fraîchement regénéré par la branche de repli.
    for (const pem of ["fullchain.pem", "privkey.pem"]) {
      expect(readFileSync(join(certs, pem))).toEqual(readFileSync(join(live, domaine, pem)));
    }
    // Le renouvellement est la seconde moitié de la panne : la copie devient périmée
    // au bout de 90 jours si certbot ne la rejoue pas.
    expect(sortie).toContain("--deploy-hook");
  });

  it("retombe sur l'auto-signé quand certbot n'a rien émis pour ce nom", () => {
    const { live, certs } = bacASable();

    const sortie = lancer({ SERVER_NAME: "localhost", LETSENCRYPT_LIVE: live, CERTS_DIR: certs });

    expect(sortie).toMatch(/auto-sign/);
    expect(readFileSync(join(certs, "fullchain.pem"), "utf-8")).toContain("BEGIN CERTIFICATE");
  });
});
