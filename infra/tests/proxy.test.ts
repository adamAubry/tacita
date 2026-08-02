import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nginxConf = readFileSync(new URL("../proxy/nginx.conf", import.meta.url), "utf-8");

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
