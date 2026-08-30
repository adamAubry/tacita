import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const nginxConf = readFileSync(new URL("../proxy/nginx.conf", import.meta.url), "utf-8");

describe("reverse proxy TLS avec routes /_matrix, /livekit/jwt, /livekit/sfu", () => {
  it("écoute en TLS", () => {
    expect(nginxConf).toMatch(/listen\s+443\s+ssl/);
    expect(nginxConf).toMatch(/ssl_certificate\s+\S+/);
    expect(nginxConf).toMatch(/ssl_certificate_key\s+\S+/);
  });

  it("route /_matrix vers Synapse", () => {
    // `set $synapse_upstream` puis `proxy_pass http://$synapse_upstream` : la variable
    // n'est pas cosmétique. Sans elle nginx résout `synapse` une fois au démarrage et
    // garde l'IP ; Synapse recréé ensuite, toute l'API répond 502 jusqu'au redémarrage
    // du proxy. Mesuré : conteneur déplacé de .3 à .9, proxy intact, 200.
    expect(nginxConf).toMatch(
      /location\s+\/_matrix\s*{[^}]*set\s+\$synapse_upstream\s+synapse:8008;[^}]*proxy_pass\s+http:\/\/\$synapse_upstream/s,
    );
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

describe("plus aucune route d'authentification externe", () => {
  it("`/auth` a disparu du proxy avec Keycloak", () => {
    /*
     * D-12. L'assertion porte sur l'absence : une route laissée derrière un
     * service supprimé rend 502 plutôt que 404, ce qui se lit comme une panne passagère
     * et se cherche du mauvais côté. Et si le nom `keycloak` réapparaissait un jour dans
     * un amont, ce serait un retour en arrière non décidé.
     */
    expect(nginxConf).not.toContain("location /auth");
    expect(nginxConf).not.toMatch(/keycloak/i);
  });

  it("le callback OIDC de Synapse n'est plus routé non plus", () => {
    // `/_synapse/client/` reste routé — le service de liens d'invitation et les futurs
    // endpoints de module en dependent —, mais plus rien ne sert `/oidc/callback`.
    expect(nginxConf).toMatch(
      /location\s+\/_synapse\/client\/\s*{[^}]*set\s+\$synapse_upstream\s+synapse:8008;[^}]*proxy_pass\s+http:\/\/\$synapse_upstream/s,
    );
    expect(nginxConf).not.toContain("oidc/callback");
  });
});

describe("API d'admin de join forcé bloquée au proxy", () => {
  it("/_synapse/admin/ répond 404, placé avant la route /_matrix générique", () => {
    const adminBlockIndex = nginxConf.indexOf("location ^~ /_synapse/admin/");
    const matrixBlockIndex = nginxConf.indexOf("location /_matrix");
    expect(adminBlockIndex).toBeGreaterThan(-1);
    expect(adminBlockIndex).toBeLessThan(matrixBlockIndex);

    const adminBlock = nginxConf.match(/location\s+\^~\s+\/_synapse\/admin\/\s*{([^}]*)}/s)?.[1];
    expect(adminBlock).toMatch(/return\s+404/);
  });
});

describe("le certificat de dev couvre le nom que Synapse appelle", () => {
  const script = readFileSync(new URL("../proxy/generate-dev-certs.sh", import.meta.url), "utf-8");

  it("le script lit SERVER_NAME dans .env, au lieu de retomber sur localhost", () => {
    // Le README fait lancer le script juste après `cp .env.example .env`, sans rien
    // exporter. Sans cette lecture, le certificat portait `CN=localhost` alors que
    // Synapse appelle `chat.example.org` : un subjectAltName juste, sur le mauvais nom
    // — la panne que venait de corriger, revenue par la porte d'à côté.
    // ponytail: garde par chaîne ; la preuve réelle est le certificat régénéré, que
    // seule la cible de fumée exerce. Celui-ci empêche la régression silencieuse.
    expect(script).toMatch(/ENV_FILE=/);
    expect(script).toMatch(/SERVER_NAME="\$\{SERVER_NAME:-\$\(lire_env SERVER_NAME\)\}"/);
  });

  it("subjectAltName porte le homeserver et call., les deux seuls noms servis en TLS", () => {
    expect(script).toMatch(/-addext "subjectAltName=/);
    expect(script).toMatch(/ALT="DNS:\$\{NAME\},DNS:call\.\$\{NAME\}"/);
    // Le TURN n'a pas de nom à lui : il s'annonce sous SERVER_NAME, que le premier
    // SAN couvre déjà. Un troisième nom serait un enregistrement DNS de plus à créer,
    // et un certificat à réémettre le jour où on l'oublie.
    expect(script).not.toContain("TURN_DOMAIN");
  });
});

/**
 * **le plafond de téléversement doit être annonçable au client.**
 *
 * Un rejet produit par nginx n'atteint jamais Synapse, donc ne porte aucun en-tête CORS :
 * le navigateur masque le statut au JavaScript et ne rend qu'une erreur d'origine. Le
 * client ne peut alors pas distinguer « refusé pour toujours » de « réseau coupé », et
 * une file d'envoi réessaie en boucle. Mesuré, avec un envoi de plus de
 * 200 Mo.
 */
describe("un 413 reste lisible par le navigateur", () => {
  const bloc = /location @televersement_trop_gros \{([^}]*)\}/s.exec(nginxConf)?.[1];

  it("le 413 est routé vers un bloc qui pose les en-têtes CORS", () => {
    expect(nginxConf).toMatch(/error_page\s+413\s+@televersement_trop_gros;/);
    expect(bloc, "bloc @televersement_trop_gros absent").toBeDefined();
    // `always` : sans lui, nginx n'ajoute les en-têtes que sur 2xx et 3xx — donc jamais
    // sur celui-ci, ce qui annulerait tout le correctif.
    expect(bloc).toMatch(/add_header Access-Control-Allow-Origin\s+\*\s+always;/);
  });

  it("le corps est une erreur Matrix, pas une page HTML", () => {
    // Le client lit `errcode` pour classer : un code qui ne se résout pas par l'attente
    // doit passer `failed`, pas boucler (règle 2).
    expect(bloc).toContain("M_TOO_LARGE");
    expect(bloc).toMatch(/return 413/);
    expect(bloc).toMatch(/default_type application\/json;/);
  });

  it("l'en-tête n'est pas posé sur le chemin normal — il y en aurait deux", () => {
    // Synapse pose déjà `Access-Control-Allow-Origin` sur ses propres réponses ; un
    // `add_header` inconditionnel en produirait un second, et les navigateurs refusent.
    const matrix = /location \/_matrix \{([^}]*)\}/s.exec(nginxConf)?.[1];
    expect(matrix).not.toContain("Access-Control-Allow-Origin");
  });
});

/**
 * **Le piège de `proxy_pass` avec une variable**, mesuré contre nginx 1.27-alpine le
 * 29/08/2026 — le digest même du compose, pas une lecture de doc.
 *
 * Quand `proxy_pass` porte une **variable**, nginx ne peut plus déterminer la part de
 * l'URI à remplacer. Il n'applique donc aucune substitution : avec une partie d'URI il
 * envoie cette URI **littérale** et jette le reste de la requête ; sans partie d'URI il
 * envoie l'URI **entière**, préfixe compris. Les deux moitiés du piège se sont
 * refermées le même jour, sur trois routes :
 *
 *     /invite/       proxy_pass $amont/   → l'amont recevait « / », pas « /links »
 *     /livekit/jwt   proxy_pass $amont    → l'amont recevait « /livekit/jwt/sfu/get »
 *     /livekit/sfu   proxy_pass $amont    → l'amont recevait « /livekit/sfu/rtc/… »
 *
 * Trois services joignables, trois 404 : aucun lien d'invitation, et aucun appel — le
 * jeton et la négociation WebSocket échouaient tous les deux. Et rien ne pouvait le
 * voir, parce que les tests lisaient la chaîne du `proxy_pass` et la trouvaient
 * conforme à ce qu'on croyait qu'elle faisait (règle 7).
 *
 * La seule forme qui garde la re-résolution DNS **et** le bon chemin est
 * `rewrite … break` + `proxy_pass` sans partie d'URI.
 */
describe("le préfixe d'une route est retiré là où l'amont sert à la racine", () => {
  /** Les blocs `location`, avec leur motif de correspondance et leur corps. */
  const blocs = [...nginxConf.matchAll(/location\s+(=\s+)?(\^~\s+)?(\S+)\s*{([^}]*)}/gs)].map(
    ([, exact, , motif, corps]) => ({ exact: Boolean(exact), motif: motif!, corps: corps! }),
  );

  it("aucun proxy_pass ne mêle une variable et une partie d'URI, sauf en location exacte", () => {
    // C'est *la* combinaison qui jette le reste de l'URI. En `location =` il n'y a pas
    // de reste, donc l'URI littérale est exactement la bonne — `/push/config` en vit.
    for (const { exact, motif, corps } of blocs) {
      const passe = /proxy_pass\s+http:\/\/\$[a-z_]+(\S*);/.exec(corps);
      if (!passe || !passe[1]) continue;
      expect(exact, `location ${motif} : proxy_pass avec variable ET partie d'URI`).toBe(true);
    }
  });

  /**
   * Les trois amonts qui servent à la racine, nommés ici parce que c'est une
   * connaissance que la conf ne porte pas : `invite-tokens` sert `/links`,
   * `lk-jwt-service` sert `/sfu/get`, le SFU sert `/rtc`. Aucun des trois ne connaît le
   * préfixe sous lequel le proxy le monte, et c'est la bonne frontière — donc c'est au
   * proxy de le retirer, et à ce test de vérifier qu'il le fait encore.
   */
  for (const prefixe of ["/invite/", "/livekit/jwt", "/livekit/sfu"]) {
    it(`${prefixe} retire son préfixe par un rewrite, et le rewrite porte le même préfixe`, () => {
      const bloc = blocs.find((b) => b.motif === prefixe);
      expect(bloc, `aucune location ${prefixe}`).toBeTruthy();

      // Le préfixe du rewrite doit être celui de la location : deux valeurs qui doivent
      // s'accorder, et rien d'autre ne les relie.
      const nu = prefixe.replace(/\/$/, "");
      const attendu = new RegExp(`rewrite\\s+\\^${nu.replace(/\//g, "\\/")}\\/\\?\\(\\.\\*\\)\\$\\s+\\/\\$1\\s+break;`);
      expect(bloc!.corps).toMatch(attendu);
    });
  }
});

/**
 * **Deux nombres qui doivent s'accorder, dans deux dépôts différents.** Le client
 * s'accorde `pollTimeout + BUFFER_PERIOD_MS` avant d'abandonner un `/sync` ; le proxy,
 * lui, a un défaut de 60 s. Mesuré au banc contre le digest du compose :
 * un amont qui répond en 90 s se solde par un **504 à 60,1 s**, cinquante secondes avant
 * que celui qui attend n'ait renoncé.
 *
 * En régime établi Synapse répond en 30 s, donc rien ne mord — et c'est bien le problème :
 * ça ne mord qu'au redémarrage, caches froids, sur le premier `/sync`, c'est-à-dire au
 * moment où personne ne cherche la cause du côté du proxy.
 *
 * Les constantes sont **relues dans le SDK épinglé**, pas recopiées : un bump qui
 * allongerait la patience du client doit faire rougir ce test, sans quoi l'écart se
 * refermerait en silence (règle 7). Si l'une d'elles disparaît, ce test échoue aussi —
 * c'est voulu : le budget est alors à re-dériver, pas à supposer.
 */
describe("le proxy attend plus longtemps que le client sur /sync", () => {
  // Résolu depuis `client-core`, qui déclare la dépendance : pnpm n'aplatit pas
  // `node_modules`, et un chemin en dur pointerait sur la mise en page d'aujourd'hui.
  const sdk = readFileSync(
    createRequire(new URL("../../packages/client-core/package.json", import.meta.url)).resolve(
      "matrix-js-sdk/lib/sync.js",
    ),
    "utf-8",
  );

  const constante = (nom: RegExp, quoi: string): number => {
    const trouve = nom.exec(sdk);
    expect(trouve, `${quoi} introuvable dans matrix-js-sdk : budget à re-dériver`).toBeTruthy();
    return Number(trouve![1]) * Number(trouve![2]);
  };

  it("proxy_read_timeout de /_matrix dépasse le budget que le client s'accorde", () => {
    // `pollTimeout: 30 * 1000` et `const BUFFER_PERIOD_MS = 80 * 1000`, tels qu'écrits.
    const budgetClientS =
      (constante(/pollTimeout:\s*(\d+)\s*\*\s*(\d+)/, "pollTimeout") +
        constante(/BUFFER_PERIOD_MS\s*=\s*(\d+)\s*\*\s*(\d+)/, "BUFFER_PERIOD_MS")) /
      1000;

    const bloc = /location\s+\/_matrix\s*{([^}]*)}/s.exec(nginxConf)?.[1];
    const timeoutS = Number(/proxy_read_timeout\s+(\d+)s;/.exec(bloc ?? "")?.[1]);

    expect(timeoutS, "aucun proxy_read_timeout sur /_matrix : nginx retombe à 60 s").toBeGreaterThan(0);
    expect(
      timeoutS,
      `le proxy renonce à ${timeoutS}s alors que le client attend ${budgetClientS}s`,
    ).toBeGreaterThan(budgetClientS);
  });
});
