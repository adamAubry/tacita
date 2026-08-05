import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf-8");

const compose = parse(read("../docker-compose.yml"));
const nginxConf = read("../proxy/nginx.conf");
const envExample = read("../.env.example");
const dockerfile = read("../../apps/invite-tokens/Dockerfile");
const lockfile = read("../../pnpm-lock.yaml");
const initScript = read("../postgres/10-invite-tokens.sh");

const service = compose.services["invite-tokens"];

describe("REQ-INF-15 — le service de liens d'invitation est provisionné par ce module", () => {
  it("un service invite-tokens est construit depuis l'app de la spec 12", () => {
    expect(service).toBeDefined();
    expect(service.build).toMatchObject({
      context: "..",
      dockerfile: "apps/invite-tokens/Dockerfile",
    });
  });

  it("l'image de base est épinglée par digest et la version de pg suit le lockfile", () => {
    expect(dockerfile).toMatch(/^FROM node@sha256:[0-9a-f]{64}$/m);

    const [, épinglée] = /npm install[^\n]*\bpg@(\d+\.\d+\.\d+)/.exec(dockerfile) ?? [];
    const [, résolue] = /^ {2}pg@(\d+\.\d+\.\d+):/m.exec(lockfile) ?? [];
    expect(épinglée).toBeDefined();
    expect(épinglée).toBe(résolue);
  });

  it("base PostgreSQL dédiée, jamais une table dans celle de Synapse", () => {
    expect(service.environment.DATABASE_URL).toContain("/invite_tokens");
    expect(service.environment.DATABASE_URL).not.toContain("/synapse");

    // La base n'existe pas toute seule : sans ce script, le service démarre et échoue
    // à la première requête.
    const postgres = compose.services.postgres;
    expect(postgres.volumes).toContainEqual(
      "./postgres/10-invite-tokens.sh:/docker-entrypoint-initdb.d/10-invite-tokens.sh:ro",
    );
    expect(initScript).toMatch(/createdb -U "\$POSTGRES_USER" invite_tokens/);
  });

  /**
   * Le critère central de REQ-INF-15. La spec 12 borne les dégâts d'une compromission en
   * ne donnant au service **aucun pouvoir Matrix** ; le raccordement est exactement
   * l'endroit où on le lui rendrait sans y penser, par confort de déploiement.
   */
  it("aucun secret d'administration Synapse dans son environnement", () => {
    const environnement = JSON.stringify(service.environment);

    for (const secret of [
      "SYNAPSE_REGISTRATION_SHARED_SECRET",
      "SYNAPSE_MACAROON_SECRET_KEY",
      "SYNAPSE_FORM_SECRET",
      "KEYCLOAK_ADMIN_PASSWORD",
      "KEYCLOAK_OIDC_CLIENT_SECRET",
    ]) {
      expect(environnement).not.toContain(secret);
    }
    // Et rien qui ressemble à un jeton d'accès ou à un pouvoir d'administration.
    expect(environnement).not.toMatch(/ADMIN|ACCESS_TOKEN|SHARED_SECRET/i);
  });

  it("il joint Synapse par le réseau du compose, pas par le proxy TLS", () => {
    // Passer par `https://${SERVER_NAME}` rejouerait les quatre causes du 503 OIDC.
    expect(service.environment.HOMESERVER_URL).toBe("http://synapse:8008");
    expect(service.depends_on.postgres).toEqual({ condition: "service_healthy" });
  });

  it("le proxy expose le service sous /invite/, préfixe retiré", () => {
    const route = /location \/invite\/\s*{([^}]*)}/s.exec(nginxConf)?.[1];
    expect(route).toBeTruthy();
    // Le `/` final est ce qui fait que `/invite/links` atteint `/links` : sans lui, le
    // service reçoit `/invite/links` et répond 404 à tout.
    expect(route).toMatch(/proxy_pass\s+http:\/\/\$invite_tokens_upstream\/;/);
    expect(route).toMatch(/X-Forwarded-For/); // REQ-INV-09 — la limitation par IP en dépend
  });

  it("aucun port publié : le service n'est joignable que par le proxy", () => {
    expect(service.ports).toBeUndefined();
  });

  /**
   * Le critère « `docker compose up` démarre le service », rendu vérifiable sans Docker.
   *
   * L'image lance `node --experimental-strip-types`, qui **retire** les types sans les
   * transformer : toute construction TypeScript qui *génère* du code fait échouer le
   * démarrage. Une propriété de paramètre (`constructor(readonly status: number)`) l'a
   * fait — le service ne bootait pas, avec 58 tests verts et un typecheck propre. Vitest
   * transpile pour de bon, il ne pouvait pas le voir ; seul Node le voit.
   *
   * On charge donc les modules du service **avec le moteur de production**. `server.ts`
   * tire tout le reste sauf `index.ts`, qui se connecte à PostgreSQL au chargement.
   */
  it("les sources se chargent sous le moteur de production, pas seulement sous Vitest", () => {
    const service = fileURLToPath(new URL("../../apps/invite-tokens/src/server.ts", import.meta.url));
    const matrix = fileURLToPath(new URL("../../apps/invite-tokens/src/matrix.ts", import.meta.url));

    expect(() =>
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--input-type=module",
          "-e",
          `await import(${JSON.stringify(service)}); await import(${JSON.stringify(matrix)});`,
        ],
        { stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it(".env.example dit qu'il n'a aucune variable propre, et pourquoi", () => {
    expect(envExample).toMatch(/spec 12.*REQ-INF-15/s);
    expect(envExample).toMatch(/invite_tokens/);
  });
});
