import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * D-12 — **le garde du changement de mot de passe tient sur trois fichiers qui ne se
 * lisent jamais ensemble**, et retirer n'importe lequel des trois le désarme en silence.
 *
 * 1. `proxy/nginx.conf` ferme `POST /_matrix/client/v3/account/password`. Sans ce bloc,
 *    l'UIA `m.login.password` de l'endpoint standard suffit à changer le mot de passe :
 *    le garde devient décoratif, et **rien ne casse** — c'est le pire des symptômes.
 * 2. `synapse/homeserver.yaml.tmpl` charge le module, seul chemin restant.
 * 3. `synapse/Dockerfile` met son répertoire dans le `PYTHONPATH` : sans lui, `modules:`
 *    lève au démarrage et le homeserver ne boote pas du tout (règle 4).
 *
 * Ce que ce fichier ne prouve pas : que le module accepte une vraie clé. Ça se joue contre
 * un serveur qui tourne, et l'accord des deux implémentations de la vérification est tenu
 * par `packages/client-core/tests/key-check-python.test.ts`.
 */
const ici = (c: string) => new URL(c, import.meta.url);
const lire = (c: string) => readFileSync(ici(c), "utf-8");

const nginx = lire("../proxy/nginx.conf");
const homeserver = parse(lire("../synapse/homeserver.yaml.tmpl"));
const dockerfile = lire("../synapse/Dockerfile");
const compose = parse(lire("../docker-compose.yml"));
const module = lire("../synapse/modules/tacita_password.py");
const clientCore = readFileSync(ici("../../packages/client-core/src/session.ts"), "utf-8");

const CHEMIN = "/_synapse/client/tacita/password";

describe("D-12 — l'endpoint standard de changement de mot de passe est fermé", () => {
  it("nginx renvoie 403 sur les deux versions du chemin", () => {
    /*
     * `r0` comme `v3` : Synapse sert encore l'ancien préfixe, et n'en fermer qu'un
     * laisserait un contournement d'une ligne à quiconque connaît l'API.
     */
    for (const version of ["v3", "r0"]) {
      const debut = nginx.indexOf(`location ^~ /_matrix/client/${version}/account/password`);
      expect(debut, `bloc ${version} absent`).toBeGreaterThan(-1);
      // Le corps du bloc, et rien d'autre : un `return 403;` trouvé ailleurs dans le
      // fichier ne dirait rien de celui-ci.
      const corps = nginx.slice(debut, nginx.indexOf("}", debut));
      expect(corps).toContain("return 403;");
    }
  });

  it("le blocage est en `^~`, sinon la route générique reste candidate", () => {
    // Sans `^~`, nginx compare deux préfixes et l'ordre du fichier ne tranche rien : la
    // requête pourrait repartir vers Synapse par `location /_matrix`.
    expect(nginx).toContain("location ^~ /_matrix/client/v3/account/password");
  });
});

describe("D-12 — le chemin de remplacement existe, des deux côtés", () => {
  it("le module est chargé par le homeserver", () => {
    const modules = homeserver.modules as { module: string }[];
    expect(modules.map((m) => m.module)).toContain("tacita_password.TacitaPassword");
  });

  it("son répertoire est monté et dans le PYTHONPATH", () => {
    /*
     * Les deux ensemble, et pas l'un sans l'autre : monté sans PYTHONPATH, le module est
     * là et introuvable ; dans le PYTHONPATH sans montage, le répertoire est vide. Les
     * deux cas donnent le même symptôme — Synapse refuse de démarrer.
     */
    expect(compose.services.synapse.volumes).toContain("./synapse/modules:/conf/modules:ro");
    expect(dockerfile).toMatch(/^ENV PYTHONPATH=\/conf\/modules$/m);
  });

  it("le module sert le chemin que le client appelle", () => {
    // La jonction la plus bête et la plus facile à casser : deux chaînes, deux langages,
    // rien qui les relie. Un renommage d'un côté donne un 404 que personne n'attribue.
    expect(module).toContain(`register_web_resource("${CHEMIN}"`);
    expect(clientCore).toContain(`"${CHEMIN}"`);
  });
});

describe("D-12 — la clé est vérifiée par le serveur, pas seulement par l'écran", () => {
  it("le module refuse sans descripteur de clé, plutôt que de laisser passer", () => {
    // Un compte sans clé de récupération n'a rien à opposer : laisser passer ferait du
    // garde une option, et l'interdit n°13 en ferait une promesse non tenue.
    expect(module).toMatch(/descripteur is None/);
    expect(module).toMatch(/"errcode": "M_FORBIDDEN"/);
  });

  it("la comparaison du MAC est à temps constant", () => {
    // Une comparaison de chaînes fuirait par le temps ce que le MAC existe pour protéger.
    expect(module).toContain("hmac.compare_digest");
  });

  it("la clé n'est jamais journalisée", () => {
    /*
     * D-12 dit « non stocké n'est pas non vu » ; le minimum que ce module doive tenir est
     * de ne pas l'écrire lui-même. Aucun logger n'est importé — la vérification porte sur
     * l'absence, parce qu'un `logger.info` ajouté un jour de débogage est exactement la
     * façon dont ce genre de secret finit sur disque.
     */
    expect(module).not.toMatch(/logger|logging|print\(/);
  });
});
