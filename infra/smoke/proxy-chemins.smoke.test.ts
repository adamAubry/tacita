import { describe, expect, it } from "vitest";

import { getViaProxy, postViaProxy } from "./harness";

/**
 * **Le préfixe survit-il au proxy ?** La question tient en une requête par route, et
 * aucune suite sur fichiers ne peut y répondre.
 *
 * Le 29/08/2026, trois routes montées sous un préfixe l'envoyaient tel quel — ou
 * l'envoyaient seul — à des amonts qui servent à la racine. Les trois services
 * tournaient, les trois répondaient 404, et le produit n'avait ni lien d'invitation ni
 * appel. `infra/tests/proxy.test.ts` était vert : il lisait la chaîne du `proxy_pass` et
 * la trouvait conforme à ce qu'on croyait qu'elle faisait. C'est la règle des deux
 * portes, et la seconde ne s'ouvre qu'ici.
 *
 * **Le signal est le 404, et rien d'autre.** Aucune de ces requêtes n'est authentifiée :
 * on n'éprouve pas le métier, on éprouve qu'elle *arrive*. Un 400 ou un 401 prouve que
 * la route existe côté amont ; un 404 prouve que le proxy a mangé le chemin. Les codes
 * attendus sont donc ceux d'un refus, et c'est voulu.
 */
describe("les routes de invite-tokens atteignent leur service", () => {
  it("/invite/links atteint invite-tokens, qui réclame un jeton", async () => {
    // `invite-tokens` sert `/links` ; sans le retrait du préfixe il recevait `/`, et
    // `segments[0] !== "links"` rendait TACITA_UNKNOWN sur les quatre routes.
    const { status, body } = await getViaProxy("/invite/links");

    expect(status, "404 = le proxy a mangé le chemin ; 401 = le service est joint").toBe(401);
    expect(JSON.parse(body)).toMatchObject({ errcode: "TACITA_AUTH_REQUIRED" });
  });

  it("/invite/links/:token/resolve atteint la route de résolution", async () => {
    // La route la plus longue du service : trois segments, et c'est elle qui perdait le
    // plus au passage. Le jeton est bidon — le 401 arrive avant qu'on le lise, ce qui
    // est justement la garantie qu'aucun usage n'est consommé sans jeton.
    const { status } = await postViaProxy("/invite/links/jeton-de-sonde/resolve", {});

    expect(status).toBe(401);
  });
});

/**
 * Les deux routes RTC ne vivent que si l'overlay `rtc/` est monté — la pile de base ne
 * porte ni le SFU ni le service de jetons, et le proxy rend alors 502 sans qu'aucun
 * amont ait vu le moindre chemin. On sonde donc avant, et on **saute visiblement**
 * plutôt que d'assurer au vert une preuve qu'on n'a pas faite. Pour les exécuter :
 *
 *     docker compose -f docker-compose.yml -f smoke/docker-compose.yml \
 *                    -f rtc/docker-compose.yml -f rtc/dev.docker-compose.yml up -d
 */
const rtcMonte = (await postViaProxy("/livekit/jwt/sfu/get", {}).catch(() => null))?.status !== 502;

describe.skipIf(!rtcMonte)("les routes RTC atteignent leur service (overlay rtc/ requis)", () => {
  it("/livekit/jwt/sfu/get atteint lk-jwt-service", async () => {
    // Le chemin est imposé par `livekit_service_url` du `.well-known`, auquel MatrixRTC
    // ajoute `/sfu/get`. Le service sert `/sfu/get` et recevait le préfixe avec.
    // Corps vide : 400 dit qu'il a lu la requête, donc que la route existe.
    const { status } = await postViaProxy("/livekit/jwt/sfu/get", {});

    expect(status, "404 = le préfixe /livekit/jwt n'a pas été retiré").toBe(400);
  });

  it("/livekit/sfu/rtc/validate atteint le SFU", async () => {
    // `/rtc` sans upgrade WebSocket rend 404 même quand tout va bien ; `/rtc/validate`
    // rend 401 sans jeton. C'est donc lui qui distingue « route absente » de « route
    // présente », et lui seul.
    const { status } = await getViaProxy("/livekit/sfu/rtc/validate");

    expect(status, "404 = le préfixe /livekit/sfu n'a pas été retiré").toBe(401);
  });
});
