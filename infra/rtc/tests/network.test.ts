import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf-8");

const livekit = parse(read("../livekit.yaml"));
const ufw = read("../firewall/host-ufw.sh");
const securityGroup = read("../firewall/security-group.tf");
const nginxConf = read("../../proxy/nginx.conf");

describe("REQ-RTC-04 — plage UDP ouverte sur les deux couches", () => {
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

describe("REQ-RTC-05 — .well-known/matrix/client expose les rtc_foci avec CORS", () => {
  // Le corps JSON contient des accolades : on découpe sur le `return`, pas sur
  // la fin du bloc nginx.
  const matched = nginxConf.match(
    /location\s+=\s+\/\.well-known\/matrix\/client\s*{([\s\S]*?)return\s+200\s+'(.*?)';/,
  );
  const [, block, json] = matched ?? [];

  it("le proxy sert la route", () => {
    expect(matched).toBeTruthy();
    expect(block).toMatch(/default_type\s+application\/json/);
  });

  it("le corps rendu déclare un focus livekit", () => {
    // `$host` est interpolé par nginx à la requête ; neutralisé pour le parse.
    const wellKnown = JSON.parse(json!.replaceAll("$host", "chat.example.org"));

    const foci = wellKnown["org.matrix.msc4143.rtc_foci"];
    expect(foci).toHaveLength(1);
    expect(foci[0].type).toBe("livekit");
    expect(foci[0].livekit_service_url).toBe("https://chat.example.org/livekit/jwt");
    expect(wellKnown["m.homeserver"].base_url).toBe("https://chat.example.org");
  });

  it("porte Access-Control-Allow-Origin (sans quoi l'appel échoue en silence)", () => {
    expect(block).toMatch(/add_header\s+Access-Control-Allow-Origin\s+"\*"\s+always/);
  });
});
