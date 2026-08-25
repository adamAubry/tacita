import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const nginxConf = readFileSync(new URL("../proxy/nginx.conf", import.meta.url), "utf-8");
const base = parse(readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf-8"));
const staging = parse(
  readFileSync(new URL("../staging/docker-compose.yml", import.meta.url), "utf-8"),
);
const dockerfile = readFileSync(
  new URL("../../apps/web/Dockerfile", import.meta.url),
  "utf-8",
);
const nextConfig = readFileSync(
  new URL("../../apps/web/next.config.ts", import.meta.url),
  "utf-8",
);
const readme = readFileSync(new URL("../staging/README.md", import.meta.url), "utf-8");

describe("REQ-INF-16 — le shard est servi par le proxy, sur le domaine du homeserver", () => {
  it("nginx route / vers le shard, par variable d'amont", () => {
    const bloc = nginxConf.match(/location\s+\/\s*{([^}]*)}/s)?.[1];
    expect(bloc).toBeTruthy();
    // Même motif que /_matrix : sans la variable, nginx résout `web` une seule fois au
    // démarrage — et refuse même de démarrer tant que le service n'existe pas, ce qui
    // casserait la pile de base, où le shard n'est pas déployé.
    expect(bloc).toMatch(/set\s+\$web_upstream\s+web:3000;/);
    expect(bloc).toMatch(/proxy_pass\s+http:\/\/\$web_upstream/);
  });

  it("`/` reste le préfixe le plus court : les routes du socle passent avant", () => {
    // nginx choisit le préfixe le plus long, pas l'ordre du fichier — mais si l'un de
    // ces blocs disparaissait, le fourre-tout l'avalerait en silence et le symptôme
    // serait une page du shard là où l'API était attendue.
    //
    // `/auth` a quitté cette liste le 25/08/2026 : il routait Keycloak, supprimé par D-12.
    for (const prefixe of ["/_matrix", "/_synapse/client/", "/invite/"]) {
      expect(nginxConf).toContain(`location ${prefixe}`);
    }
  });

  it("le shard a une sortie autonome, tracée depuis la racine du monorepo", () => {
    expect(nextConfig).toMatch(/output:\s*"standalone"/);
    // Sans cette racine, les paquets `@tacita/*` du workspace ne sont pas embarqués :
    // l'image démarre puis meurt en MODULE_NOT_FOUND au premier import.
    expect(nextConfig).toMatch(/outputFileTracingRoot/);
  });

  it("l'image écoute sur toutes les interfaces et embarque le service worker", () => {
    // Défaut du serveur `standalone` : `localhost`, donc la seule boucle locale du
    // conteneur. Le proxy ne l'atteint jamais et le symptôme est un 502 sur `/` seul.
    expect(dockerfile).toMatch(/HOSTNAME=0\.0\.0\.0/);
    // REQ-UI-01 — `public/` n'est pas copié par la sortie autonome. Sans cette ligne,
    // `/sw.js` répond 404 et la PWA ne s'installe pas, sans rien dans les logs.
    expect(dockerfile).toMatch(/apps\/web\/public/);
  });

  it("les trois adresses publiques du shard dérivent de SERVER_NAME", () => {
    // `NEXT_PUBLIC_*` est inliné par `next build` : une valeur en dur ici produirait une
    // image qui pointe ailleurs que le déploiement qui l'a construite.
    const args = staging.services.web.build.args;
    expect(args.NEXT_PUBLIC_HOMESERVER_URL).toBe("https://${SERVER_NAME}");
    expect(args.NEXT_PUBLIC_ELEMENT_CALL_URL).toBe("https://call.${SERVER_NAME}");
    expect(args.NEXT_PUBLIC_PUSH_NOTIFY_URL).not.toMatch(/example\.org/);
  });
});

describe("REQ-INF-17 — le staging est un overlay, jamais une modification du socle", () => {
  it("le service du shard vit dans l'overlay, pas dans la pile de base", () => {
    // Règle 6 de la spec 00 (D-07) : les écarts d'environnement sont des overlays
    // chargés volontairement. Le socle reste le backend, déployable seul.
    expect(base.services.web).toBeUndefined();
    expect(staging.services.web.build.dockerfile).toBe("apps/web/Dockerfile");
  });

  it("l'overlay n'expose rien de plus que le 443 du socle", () => {
    // Une machine publique : chaque `ports:` ajouté ici est un port ouvert sur Internet.
    for (const service of Object.values(staging.services) as { ports?: unknown }[]) {
      expect(service.ports).toBeUndefined();
    }
  });

  it("l'alias réseau de D-07 est posé, avec la conséquence SSRF documentée", () => {
    expect(staging.services.proxy.networks.default.aliases).toContain("${SERVER_NAME}");
    // L'alias fait résoudre SERVER_NAME vers une adresse privée, que la protection SSRF
    // de Synapse refuse par défaut : sans la whitelist, tout login répond 503.
    expect(staging.services.proxy.networks.default.aliases.length).toBe(1);
    expect(readme).toContain("SYNAPSE_IP_RANGE_WHITELIST");
  });

  it("le runbook de machine couvre les étapes qu'aucun fichier ne porte", () => {
    for (const sujet of [/DNS/, /ufw/, /certbot/i, /kcadm/, /registrationAllowed/]) {
      expect(readme).toMatch(sujet);
    }
    // Contrôle de pré-vol de D-07 : la découverte OIDC répond 200 depuis le conteneur
    // Synapse **avant** toute création de compte.
    expect(readme).toContain("openid-configuration");
    // La composition avec `smoke/` publierait PostgreSQL et l'API Synapse sur Internet.
    expect(readme).toMatch(/smoke/);
  });
});
