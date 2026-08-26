import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// `logLevel: silent` — le compose porte le tag `!override` (port 443 du proxy),
// inconnu du parseur YAML générique.
const overlaySource = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf-8");
const overlay = parse(overlaySource, { logLevel: "silent" });
const base = parse(readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf-8"), {
  logLevel: "silent",
});
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
const callConf = readFileSync(new URL("../call.conf", import.meta.url), "utf-8");
const baseCallConf = readFileSync(new URL("../../proxy/call.conf", import.meta.url), "utf-8");
const nginx = readFileSync(new URL("../../proxy/nginx.conf", import.meta.url), "utf-8");
const config = readFileSync(new URL("../element-call.json", import.meta.url), "utf-8");

const IMAGE = overlay.services["element-call"].image as string;

describe("Element Call auto-hébergé, épinglé, et sa version consignée", () => {
  it("aucune image de l'overlay n'est référencée par un tag mutable", () => {
    // Par défaut de refus : un service ajouté demain échoue ici sans avoir été nommé.
    const images = Object.values(overlay.services)
      .map((service) => (service as { image?: string }).image)
      .filter((image): image is string => Boolean(image));

    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it("le digest servi est exactement celui que le README consigne", () => {
    // Le point de toute l'escalade E-14 : une version qu'on peut relire. Deux copies,
    // donc un test — sinon le README vieillit en silence pendant que l'image change.
    const digest = /@(sha256:[0-9a-f]{64})/.exec(IMAGE)?.[1];
    expect(digest).toBeTruthy();
    expect(readme).toContain(digest!);
  });

  it("le README porte la version et la date de résolution, pas seulement le digest", () => {
    // Un digest seul ne se relit pas : c'est la version qui dit *où* aller lire
    // `UrlParams.ts` au prochain bump.
    expect(readme).toMatch(/v0\.23\.0/);
    expect(readme).toMatch(/2026-08-07/);

    // La version est en commentaire à côté du digest — convention du compose, déjà
    // suivie par `livekit-sfu`. Le parseur YAML la retire, donc on relit la source.
    expect(overlaySource).toMatch(/element-call@sha256:[0-9a-f]{64} # v0\.23\.0/);
  });

  it("le mode MatrixRTC est épinglé, et jamais celui des événements sticky", () => {
    const { matrix_rtc_mode } = JSON.parse(config) as { matrix_rtc_mode?: string };

    // Épinglé : au défaut, c'est le réglage développeur de chaque utilisateur qui
    // décide, donc une forme d'événements différente par appareil.
    expect(matrix_rtc_mode).toBeTruthy();
    // `matrix_2_0` active MSC4354 : `activeCall()` cesserait de voir les participants
    // sans rien dire. La panne serait « aucun appel en cours », jamais une erreur.
    expect(matrix_rtc_mode).not.toBe("matrix_2_0");
  });

  it("la pile de base ne sert aucun Element Call", () => {
    // Même règle que (E-08) : sans SFU derrière, un client d'appel qui se
    // charge est un appel qui meurt à la connexion. Rien ne vaut mieux que presque.
    expect(base.services["element-call"]).toBeUndefined();
    expect(baseCallConf).not.toMatch(/^\s*(server|location|proxy_pass)\b/m);

    // Et les deux piles montent bien le même chemin, sinon l'overlay ajouterait un
    // fichier au lieu de remplacer celui de la base.
    const monte = (service: { volumes?: string[] }) =>
      (service.volumes ?? []).some((v) => v.endsWith(":/etc/nginx/call.conf:ro"));
    expect(monte(base.services.proxy)).toBe(true);
    expect(monte(overlay.services.proxy)).toBe(true);
    expect(nginx).toContain("include /etc/nginx/call.conf;");
  });

  it("l'overlay sert Element Call sous son propre nom d'hôte, pas sous un préfixe", () => {
    // Le SPA référence ses assets en chemins absolus : sous un préfixe, l'index se
    // charge et tout le reste part en 404.
    expect(callConf).toMatch(/server_name\s+~\^call\\\./);
    expect(callConf).toContain("element-call:8080");
    // Le bloc `server` de base est le défaut (`server_name _`) : une regex passe avant.
    expect(nginx).toMatch(/server_name\s+_;/);
  });
});
