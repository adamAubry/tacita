import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const livekit = parse(readFileSync(new URL("../livekit.yaml", import.meta.url), "utf-8"));
// `logLevel: silent` — le compose porte le tag `!override` (port 443
// du proxy), inconnu du parseur YAML générique.
const compose = parse(readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf-8"), {
  logLevel: "silent",
});

describe("le SFU ne crée jamais de salle de lui-même", () => {
  it("room.auto_create est false", () => {
    expect(livekit.room.auto_create).toBe(false);
  });
});

describe("découverte de l'IP publique par STUN", () => {
  it("rtc.use_external_ip est true", () => {
    expect(livekit.rtc.use_external_ip).toBe(true);
  });
});

describe("accès complet restreint au domaine du déploiement", () => {
  const homeservers =
    compose.services["lk-jwt-service"].environment.LIVEKIT_FULL_ACCESS_HOMESERVERS;

  it("LIVEKIT_FULL_ACCESS_HOMESERVERS vaut le domaine déployé", () => {
    expect(homeservers).toBe("${SERVER_NAME}");
  });

  it("n'est jamais le joker", () => {
    expect(homeservers).not.toContain("*");
  });
});

describe("TURN-TLS sur le port 443", () => {
  it("le TURN est activé et écoute en TLS sur 443", () => {
    expect(livekit.turn.enabled).toBe(true);
    expect(livekit.turn.tls_port).toBe(443);
  });

  it("un certificat est fourni (TLS terminé par LiveKit, pas de load balancer)", () => {
    expect(livekit.turn.cert_file).toBeTruthy();
    expect(livekit.turn.key_file).toBeTruthy();
    expect(livekit.turn.external_tls).toBeUndefined();
  });

  it("443/tcp du TURN est publié sur une IP dédiée, distincte du proxy", () => {
    const turnPorts: string[] = compose.services["livekit-sfu"].ports;
    expect(
      turnPorts.some((p) => p.includes("TURN_BIND_IP") && p.endsWith(":443:443/tcp")),
    ).toBe(true);

    const proxyPorts: string[] = compose.services.proxy.ports;
    expect(proxyPorts).toHaveLength(1);
    expect(proxyPorts[0]).toContain("WEB_BIND_IP");
    expect(proxyPorts[0]).not.toContain("TURN_BIND_IP");
  });
});
