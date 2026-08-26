import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf-8");

const livekit = parse(read("../livekit.yaml"));
const ufw = read("../firewall/host-ufw.sh");
const securityGroup = read("../firewall/security-group.tf");
const nginxConf = read("../../proxy/nginx.conf");
const wellKnownBase = read("../../proxy/well-known.conf");
const wellKnownRtc = read("../well-known.conf");
const composeBase = parse(read("../../docker-compose.yml"));
const composeRtc = parse(read("../docker-compose.yml"));

describe("plage UDP ouverte sur les deux couches", () => {
  const start = livekit.rtc.port_range_start;
  const end = livekit.rtc.port_range_end;

  it("le pare-feu hôte ouvre exactement cette plage en UDP", () => {
    expect(ufw).toContain(`ufw allow ${start}:${end}/udp`);
  });

  it("le groupe de sécurité cloud ouvre exactement cette plage en UDP", () => {
    const rule = securityGroup.match(
      /resource\s+"aws_vpc_security_group_ingress_rule"\s+"livekit_media_udp"\s*{([^}]*)}/s,
    )?.[1];
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/ip_protocol\s*=\s*"udp"/);
    expect(rule).toMatch(new RegExp(`from_port\\s*=\\s*${start}\\b`));
    expect(rule).toMatch(new RegExp(`to_port\\s*=\\s*${end}\\b`));
  });
});

describe("le TURN-TLS est ouvert sur les deux couches, au port de livekit.yaml", () => {
  // Même règle de miroir que la plage UDP, et même symptôme quand elle est rompue : le
  // relais de dernier recours est simplement injoignable, sans que rien ne le dise.
  const port = livekit.turn.tls_port;

  it("le pare-feu hôte ouvre ce port en TCP", () => {
    expect(ufw).toContain(`ufw allow ${port}/tcp`);
  });

  it("le groupe de sécurité cloud ouvre ce port en TCP", () => {
    const rule = securityGroup.match(
      /resource\s+"aws_vpc_security_group_ingress_rule"\s+"livekit_turn_tls"\s*{([^}]*)}/s,
    )?.[1];
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/ip_protocol\s*=\s*"tcp"/);
    expect(rule).toMatch(new RegExp(`from_port\\s*=\\s*${port}\\b`));
    expect(rule).toMatch(new RegExp(`to_port\\s*=\\s*${port}\\b`));
  });

  it("le 443 reste au proxy seul, des deux côtés", () => {
    expect(ufw).toMatch(/ufw allow 443\/tcp comment 'HTTPS \(`infra`\/02\)'/);
    expect(securityGroup).not.toContain("TURN-TLS (`infra`/02)");
  });
});

describe("les rtc_foci sont annoncés quand le RTC est déployé, jamais avant", () => {
  // Le corps JSON contient des accolades : on découpe sur le `return`, pas sur
  // la fin du bloc nginx. `$host` est interpolé par nginx à la requête ; neutralisé
  // pour le parse.
  const servi = (conf: string) => {
    const matched = conf.match(
      /location\s+=\s+\/\.well-known\/matrix\/client\s*{([\s\S]*?)return\s+200\s+'(.*?)';/,
    );
    expect(matched).toBeTruthy();
    const [, block, json] = matched!;
    return {
      block: block!,
      wellKnown: JSON.parse(json!.replaceAll("$host", "chat.example.org")),
    };
  };

  /** Le chemin de montage : c'est lui qui fait que l'overlay remplace la base. */
  const CIBLE = "/etc/nginx/well-known.conf";
  const monté = (compose: { services: Record<string, { volumes?: string[] }> }) =>
    (compose.services.proxy?.volumes ?? []).find((mount) => mount.split(":")[1] === CIBLE);

  it("le proxy sert la route par un fichier inclus, pas en dur dans nginx.conf", () => {
    expect(nginxConf).toMatch(new RegExp(`include\\s+${CIBLE};`));
    expect(nginxConf).not.toContain("rtc_foci");
  });

  it("la pile de base n'annonce aucun focus : discoverFocus rend RtcFociMissing", () => {
    const { wellKnown } = servi(wellKnownBase);
    expect(wellKnown["org.matrix.msc4143.rtc_foci"]).toBeUndefined();
    expect(wellKnown["m.homeserver"].base_url).toBe("https://chat.example.org");
    expect(monté(composeBase)).toBe(`./proxy/well-known.conf:${CIBLE}:ro`);
  });

  it("la pile avec overlay déclare un focus livekit", () => {
    const { wellKnown } = servi(wellKnownRtc);

    const foci = wellKnown["org.matrix.msc4143.rtc_foci"];
    expect(foci).toHaveLength(1);
    expect(foci[0].type).toBe("livekit");
    expect(foci[0].livekit_service_url).toBe("https://chat.example.org/livekit/jwt");
    expect(wellKnown["m.homeserver"].base_url).toBe("https://chat.example.org");
    // Même cible que la base : compose fusionne les volumes par point de montage, donc
    // l'overlay remplace le fichier au lieu de s'y ajouter (un doublon ferait échouer
    // le démarrage du conteneur).
    expect(monté(composeRtc)).toBe(`./well-known.conf:${CIBLE}:ro`);
  });

  it("les deux portent Access-Control-Allow-Origin (sans quoi la découverte échoue en silence)", () => {
    for (const conf of [wellKnownBase, wellKnownRtc]) {
      expect(servi(conf).block).toMatch(/add_header\s+Access-Control-Allow-Origin\s+"\*"\s+always/);
      expect(servi(conf).block).toMatch(/default_type\s+application\/json/);
    }
  });
});
