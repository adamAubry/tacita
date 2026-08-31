/**
 * Durcissement — la Content-Security-Policy qui contient une éventuelle XSS : même si du
 * code étranger entrait dans la page, il ne pourrait ni s'exécuter, ni charger un script
 * tiers, ni exfiltrer un jeton ou une clé Megolm vers un autre serveur. C'est le mur qui
 * fait qu'une petite faille reste petite ; l'app en a besoin plus que la moyenne, ses clés
 * de déchiffrement vivent dans le navigateur.
 *
 * Construite ici (fonction pure, testable sans requête) ; posée par `middleware.ts` avec
 * un nonce tiré à chaque requête.
 *
 * Choix qui ne sont pas évidents :
 *  - `script-src 'nonce-…' 'strict-dynamic'`, **jamais** `'unsafe-inline'` : sans ça la CSP
 *    ne protège de rien (un `<script>` injecté s'exécuterait). Next appose ce nonce sur ses
 *    propres scripts d'hydratation ; `strict-dynamic` les laisse charger le reste des chunks.
 *  - `style-src 'unsafe-inline'` : 39 composants rendent des `style={{}}` que le SSR émet en
 *    attribut `style=`. Les nonces ne couvrent pas les attributs, et injecter du style ne
 *    fait pas exécuter de code — le risque est sans commune mesure avec l'inline de script.
 *  - `img-src`/`media-src blob:` : les pièces jointes sont téléchargées chiffrées puis
 *    déchiffrées en `Blob` local (MediaMessage, MediaViewer) — leur URL est un `blob:`.
 *  - `frame-src` = la seule origine d'Element Call, injectée depuis le déploiement :
 *    l'iframe d'appel (EcranAppel.tsx) est le seul cadre tiers légitime.
 *  - `connect-src 'self'` : Synapse, Keycloak, passerelle push et liens d'invitation sont
 *    tous joints par le proxy, à la même origine. `/sync` est du long-polling HTTP, pas de
 *    WebSocket sortant à autoriser (le SFU, lui, est joint depuis l'iframe, pas d'ici).
 */
export interface CspOptions {
  /** `NEXT_PUBLIC_ELEMENT_CALL_URL` du déploiement — seule son origine sert. */
  elementCallUrl: string;
  /** En dev, le HMR de Next évalue du code à la volée : `'unsafe-eval'` seulement là. */
  dev: boolean;
}

export function buildCsp(nonce: string, { elementCallUrl, dev }: CspOptions): string {
  const elementCallOrigin = new URL(elementCallUrl).origin;
  const script = dev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    `default-src 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `script-src ${script}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `media-src 'self' blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `frame-src ${elementCallOrigin}`,
  ].join("; ");
}
