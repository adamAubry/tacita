import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf-8");

const compose = parse(read("../docker-compose.yml"));
const nginxConf = read("../proxy/nginx.conf");
const envExample = read("../.env.example");
const dockerfile = read("../../apps/push-gateway/Dockerfile");
const lockfile = read("../../pnpm-lock.yaml");
const readme = read("../README.md");

const service = compose.services["push-gateway"];

describe("REQ-INF-14 — la passerelle Web Push est provisionnée par ce module", () => {
  it("un service push-gateway est construit depuis l'app de la spec 03", () => {
    expect(service).toBeDefined();
    // Contexte à la racine du dépôt : l'image s'installe depuis le lockfile du
    // workspace, pas en résolvant les dépendances au build.
    expect(service.build).toMatchObject({
      context: "..",
      dockerfile: "apps/push-gateway/Dockerfile",
    });
  });

  it("l'image de base est épinglée par digest, comme les autres du compose", () => {
    // Un tag est mutable : `node:22-alpine` de la semaine prochaine n'est pas celui
    // qui a été testé. Même règle que pour les images du compose.
    expect(dockerfile).toMatch(/^FROM node@sha256:[0-9a-f]{64}$/m);
  });

  it("la version de web-push installée est celle que le lockfile a résolue", () => {
    // L'image n'embarque pas pnpm pour une seule dépendance : elle épingle la version
    // en dur. Ce test est ce qui remplace le lockfile — sans lui, l'image dériverait
    // silencieusement de ce qui a été testé.
    // Ancré sur la ligne d'installation : `web-push@…` apparaît aussi dans les
    // commentaires du Dockerfile, et lire un commentaire ne prouverait rien.
    const [, épinglée] = /npm install[^\n]*web-push@(\d+\.\d+\.\d+)/.exec(dockerfile) ?? [];
    const [, résolue] = /^ {2}web-push@(\d+\.\d+\.\d+):/m.exec(lockfile) ?? [];

    expect(épinglée).toBeDefined();
    expect(épinglée).toBe(résolue);
  });

  it("les trois variables VAPID lui sont passées et figurent dans .env.example", () => {
    for (const key of ["VAPID_SUBJECT", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]) {
      expect(service.environment[key]).toBe(`\${${key}}`);
      expect(envExample).toMatch(new RegExp(`^${key}=`, "m"));
    }
  });

  it("aucun port n'est publié : l'endpoint de notification n'a pas d'authentification", () => {
    // Publier la passerelle sur l'hôte en ferait un relais de push ouvert — n'importe
    // qui pourrait lui faire émettre des notifications vers l'endpoint de son choix.
    expect(service.ports).toBeUndefined();
  });

  it("le proxy n'expose que la clé publique VAPID, jamais l'endpoint de notification", () => {
    expect(nginxConf).toMatch(
      /location = \/push\/config\s*{[^}]*proxy_pass\s+http:\/\/\$push_gateway_upstream\/config;/s,
    );

    // Toute route vers la passerelle doit viser `/config` et rien d'autre : c'est ce
    // qui garde `/_matrix/push/v1/notify` hors d'atteinte depuis l'extérieur.
    const versLaPasserelle = [...nginxConf.matchAll(/proxy_pass\s+([^;]*push_gateway[^;]*);/g)];
    expect(versLaPasserelle).toHaveLength(1);
    expect(versLaPasserelle[0]![1]).toMatch(/\/config$/);
  });

  it("l'URL du pusher à enregistrer côté client est documentée", () => {
    // Sans elle le raccordement est inutilisable : le client ne peut pas deviner que
    // Synapse doit joindre la passerelle par son nom interne.
    expect(readme).toContain("http://push-gateway:8008/_matrix/push/v1/notify");
    expect(readme).toContain("/push/config");
  });

  /**
   * Règle 7, appliquée au dernier maillon que rien ne relisait.
   *
   * L'URL du pusher est un **nom du réseau du compose** : elle résout vers une adresse
   * privée, que la protection SSRF de Synapse refuse par défaut. Le raccordement était
   * donc correct des deux côtés — le client enregistre la bonne URL, la passerelle écoute
   * dessus — et Synapse ne l'appelait jamais. Aucun test ne pouvait l'attraper : les deux
   * moitiés du contrat étaient justes, et le trou était entre elles (règle 1).
   *
   * La liste vivait dans `.env.example` avec un commentaire ne parlant que d'OIDC. Elle
   * est maintenant livrée remplie, et ce test est ce qui empêche de la revider en croyant
   * ne toucher qu'au login.
   */
  it("la protection SSRF de Synapse laisse passer l'appel du pusher", () => {
    const [, liste] = /^SYNAPSE_IP_RANGE_WHITELIST=(.*)$/m.exec(envExample) ?? [];
    expect(liste, "SYNAPSE_IP_RANGE_WHITELIST absent de .env.example").toBeDefined();

    const plages = JSON.parse(liste!) as string[];
    // Vide, Synapse n'appelle jamais `push-gateway` — et rien ne le dit : le pusher est
    // enregistré, l'application annonce des notifications actives, aucune n'arrive.
    expect(plages.length, "liste vide : aucun push ne peut partir").toBeGreaterThan(0);
    expect(plages.some((plage) => /^(10|172|192)\./.test(plage))).toBe(true);

    // Et la raison est écrite là où on la cherchera : dans le gabarit que l'opérateur
    // lit, et dans la doc du module.
    const gabarit = read("../synapse/homeserver.yaml.tmpl");
    expect(gabarit).toContain("REQ-PSH-01");
    expect(readme).toContain("SYNAPSE_IP_RANGE_WHITELIST");
  });
});
