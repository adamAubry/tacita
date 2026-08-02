import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const homeserver = parse(
  readFileSync(new URL("../synapse/homeserver.yaml.tmpl", import.meta.url), "utf-8"),
);
const compose = parse(
  readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf-8"),
);

describe("REQ-INF-02 — fédération désactivée", () => {
  it("federation_domain_whitelist est un tableau vide", () => {
    expect(homeserver.federation_domain_whitelist).toEqual([]);
  });
});

describe("REQ-INF-03 — chiffrement par défaut sur tout salon", () => {
  it("encryption_enabled_by_default_for_room_type vaut 'all'", () => {
    expect(homeserver.encryption_enabled_by_default_for_room_type).toBe("all");
  });
});

describe("REQ-INF-04 — inscription fermée", () => {
  it("enable_registration est false", () => {
    expect(homeserver.enable_registration).toBe(false);
  });

  it("un registration_shared_secret est défini pour le script d'admin", () => {
    expect(homeserver.registration_shared_secret).toBeTruthy();
  });
});

describe("REQ-INF-05 — rate limiting desserré (>= 10x les défauts)", () => {
  const defaults = {
    rc_message: { per_second: 0.2, burst_count: 10 },
    "rc_login.address": { per_second: 0.003, burst_count: 5 },
    "rc_login.account": { per_second: 0.003, burst_count: 5 },
    "rc_joins.local": { per_second: 0.1, burst_count: 10 },
    "rc_joins.remote": { per_second: 0.01, burst_count: 10 },
    "rc_invites.per_room": { per_second: 0.3, burst_count: 10 },
    "rc_invites.per_user": { per_second: 0.003, burst_count: 5 },
  };

  it("rc_message >= 10x le défaut", () => {
    expect(homeserver.rc_message.per_second).toBeGreaterThanOrEqual(
      defaults.rc_message.per_second * 10,
    );
    expect(homeserver.rc_message.burst_count).toBeGreaterThanOrEqual(
      defaults.rc_message.burst_count * 10,
    );
  });

  it("rc_login.address et rc_login.account >= 10x le défaut", () => {
    for (const key of ["address", "account"] as const) {
      expect(homeserver.rc_login[key].per_second).toBeGreaterThanOrEqual(
        defaults["rc_login.address"].per_second * 10,
      );
      expect(homeserver.rc_login[key].burst_count).toBeGreaterThanOrEqual(
        defaults["rc_login.address"].burst_count * 10,
      );
    }
  });

  it("rc_joins.local et rc_joins.remote >= 10x le défaut", () => {
    expect(homeserver.rc_joins.local.per_second).toBeGreaterThanOrEqual(
      defaults["rc_joins.local"].per_second * 10,
    );
    expect(homeserver.rc_joins.remote.per_second).toBeGreaterThanOrEqual(
      defaults["rc_joins.remote"].per_second * 10,
    );
  });

  it("rc_invites.per_room et rc_invites.per_user >= 10x le défaut", () => {
    expect(homeserver.rc_invites.per_room.per_second).toBeGreaterThanOrEqual(
      defaults["rc_invites.per_room"].per_second * 10,
    );
    expect(homeserver.rc_invites.per_user.per_second).toBeGreaterThanOrEqual(
      defaults["rc_invites.per_user"].per_second * 10,
    );
  });
});

describe("REQ-INF-06 — taille d'upload maximale", () => {
  it("max_upload_size vaut 200M", () => {
    expect(homeserver.max_upload_size).toBe("200M");
  });
});

describe("REQ-INF-07 — rétention illimitée, définie explicitement", () => {
  it("le bloc retention est présent, activé, sans limite ni purge programmée", () => {
    expect(homeserver.retention).toBeDefined();
    expect(homeserver.retention.enabled).toBe(true);
    expect(homeserver.retention.default_policy.max_lifetime).toBeNull();
    expect(homeserver.retention.purge_jobs).toEqual([]);
  });
});

describe("REQ-INF-08 — backend média S3", () => {
  it("media_storage_providers utilise s3_storage_provider.S3StorageProviderBackend", () => {
    const [provider] = homeserver.media_storage_providers;
    expect(provider.module).toBe("s3_storage_provider.S3StorageProviderBackend");
    expect(provider.config.bucket).toBeTruthy();
  });

  it("SSE-S3 est activé au niveau du bucket (défense en profondeur, cf LIMITES.md)", () => {
    const initCommand = compose.services["minio-init"].command.join(" ");
    expect(initCommand).toContain("mc encrypt set sse-s3");
  });
});

describe("REQ-INF-09 — OIDC Keycloak seul fournisseur d'auth", () => {
  it("l'authentification par mot de passe natif est désactivée", () => {
    expect(homeserver.password_config.enabled).toBe(false);
  });

  it("un provider OIDC keycloak est configuré", () => {
    const [provider] = homeserver.oidc_providers;
    expect(provider.idp_id).toBe("keycloak");
    expect(provider.issuer).toContain("/auth/realms/tacita");
  });

  it("Keycloak sert sous le préfixe de l'issuer", () => {
    // KC_HOSTNAME ne fixe que les URLs annoncées : sans KC_HTTP_RELATIVE_PATH,
    // Keycloak sert à la racine et l'issuer qu'il publie répond 404.
    const [provider] = homeserver.oidc_providers;
    const issuerPath = new URL(provider.issuer.replace("${SERVER_NAME}", "example.org"))
      .pathname;
    const [prefix] = issuerPath.split("/realms/");
    expect(compose.services.keycloak.environment.KC_HTTP_RELATIVE_PATH).toBe(prefix);
  });
});
