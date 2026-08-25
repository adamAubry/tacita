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

describe("REQ-INF-04 — inscription ouverte, sans garde (D-13)", () => {
  it("l'inscription est ouverte : le produit fait créer son compte depuis l'app", () => {
    expect(homeserver.enable_registration).toBe(true);
  });

  it("aucun jeton n'est exigé, et l'absence de la ligne est le contrat", () => {
    /*
     * Règle 7 — une valeur retirée est indétectable si rien ne la relit. Remettre
     * `registration_requires_token` remettrait un code d'invitation dans le parcours sans
     * qu'aucun écran ne change : ce test est le seul endroit qui s'en apercevrait.
     * L'exposition assumée en échange est dans infra/LIMITES.md (D-13).
     */
    expect(homeserver.registration_requires_token).toBeUndefined();
  });

  it("le risque est signé explicitement, sinon Synapse refuse de démarrer", () => {
    /*
     * **Règle 4, prise en flagrant délit le 25/08/2026.** Les deux assertions ci-dessus
     * étaient vertes et le homeserver bootait en boucle : « Error in configuration: You
     * have enabled open registration without any verification » (v1.155.0). Ouvrir
     * l'inscription sans e-mail, captcha ni jeton **exige** ce drapeau — Synapse veut que
     * l'opérateur écrive qu'il accepte le risque plutôt que de le subir par défaut.
     *
     * Le test ne prouve toujours pas que le serveur démarre : il empêche seulement la
     * ligne de repartir avec la prochaine passe sur ce fichier.
     */
    expect(homeserver.enable_registration_without_verification).toBe(true);
  });

  it("un registration_shared_secret reste défini pour le script d'admin", () => {
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
  // `toEqual` et non `toMatchObject` : c'est l'assertion qui compte. Elle dit à la fois
  // que le bloc existe (pas d'absence par omission), que la rétention est désactivée, et
  // que rien d'autre ne traîne dedans. Un `purge_jobs: []` réintroduit par quelqu'un qui
  // le croit désactivant — ce qu'il n'est pas, il installe un job quotidien par défaut —
  // fait échouer ce test au lieu de purger l'historique en silence.
  it("le bloc retention est présent et ne porte que la désactivation", () => {
    expect(homeserver.retention).toEqual({ enabled: false });
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

describe("REQ-INF-09 — identifiant + mot de passe, portés par Synapse", () => {
  it("l'authentification par mot de passe native est active", () => {
    // Réécrite le 25/08/2026 (D-12) : Keycloak supprimé, Matrix porte l'identité.
    expect(homeserver.password_config.enabled).toBe(true);
  });

  it("aucun fournisseur externe ne subsiste", () => {
    /*
     * L'assertion porte sur l'absence, et c'est voulu : un `oidc_providers` oublié
     * rouvrirait un second chemin d'authentification que rien dans le produit ne sert,
     * et que rien ne surveillerait.
     */
    expect(homeserver.oidc_providers).toBeUndefined();
    expect(homeserver.sso).toBeUndefined();
  });

  it("D-12 — la ré-authentification ne se sépare pas de la connexion, et c'est écrit", () => {
    /*
     * Le fait qui décide de toute la forme du garde de D-12, vérifié dans l'image
     * v1.155.0 : `password_enabled_for_login` et `password_enabled_for_reauth` dérivent
     * du même `enabled`. `true` donne les deux. Un stage UIA maison serait donc offert à
     * côté de `m.login.password`, qui resterait acceptable — le garde serait décoratif.
     *
     * D'où le blocage au proxy plutôt qu'en UIA. Ce test relie la décision à sa raison :
     * si quelqu'un passe un jour `enabled` à `only_for_reauth` en croyant durcir, il
     * casse la connexion et laisse le garde intact.
     */
    expect(homeserver.password_config.enabled).not.toBe("only_for_reauth");
  });
});

describe("REQ-INF-18 — annuaire ouvert à tous les comptes locaux", () => {
  /**
   * E-21, tranchée le 21/08/2026. Le défaut de Synapse (`false`) ne liste que les
   * comptes avec qui on partage déjà un salon ; ce déploiement n'a aucun salon public,
   * donc l'annuaire ne rendait rien et « Ajouter un ami » n'aboutissait qu'avec un
   * identifiant exact déjà connu.
   */
  it("search_all_users est explicitement true", () => {
    expect(homeserver.user_directory.search_all_users).toBe(true);
  });

  it("l'annuaire lui-même est explicitement activé, pas laissé au défaut", () => {
    expect(homeserver.user_directory.enabled).toBe(true);
  });

  it("la reconstruction de l'annuaire est documentée là où l'opérateur la lira", () => {
    // Sans le job `regenerate_directory`, le réglage ne vaut que pour les comptes créés
    // après lui : les comptes existants restent introuvables et le changement paraît
    // sans effet. La valeur seule ne suffit donc pas — la procédure fait partie de la REQ.
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
    expect(readme).toContain("regenerate_directory");
  });
});
