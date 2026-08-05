/*
 * REQ-UI-01 — service worker de **coquille applicative**, et rien d'autre.
 *
 * Interdit n°8 : aucun contenu déchiffré dans le cache du service worker, y compris en
 * développement. Ici, la règle est tenue par construction plutôt que par vigilance :
 *
 *  - le précache est une **liste close** de routes de coquille, écrite ci-dessous ;
 *  - le `fetch` ne met en cache **que** ce qui vient de `/_next/static/` — les assets
 *    versionnés par le build, qui ne peuvent pas contenir de données utilisateur ;
 *  - tout le reste passe au réseau sans jamais être écrit.
 *
 * Une réponse de `/_matrix/…` n'a donc aucun chemin vers le cache : ce n'est pas une
 * précaution, c'est qu'aucune branche ne l'y mène.
 */
const VERSION = "tacita-coquille-v1";

/** La coquille : des routes vides et le manifeste. Zéro donnée utilisateur. */
const COQUILLE = ["/", "/recherche", "/mentions", "/profil", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(COQUILLE)));
});

self.addEventListener("activate", (event) => {
  // Les caches d'une version précédente contiennent une coquille périmée : elle ferait
  // tourner du code qui n'est plus celui de l'app.
  event.waitUntil(
    caches
      .keys()
      .then((noms) => Promise.all(noms.filter((nom) => nom !== VERSION).map((nom) => caches.delete(nom)))),
  );
});

self.addEventListener("fetch", (event) => {
  const requete = event.request;
  const url = new URL(requete.url);
  const memeOrigine = url.origin === self.location.origin;

  // Seuls les assets versionnés du build entrent au cache. Le test de REQ-UI-01 relit
  // cette condition : l'élargir est ce qui ferait entrer des données utilisateur.
  const cachable = memeOrigine && requete.method === "GET" && url.pathname.startsWith("/_next/static/");

  if (cachable) {
    event.respondWith(
      caches.match(requete).then(
        (enCache) =>
          enCache ??
          fetch(requete).then((reponse) => {
            if (reponse.ok) {
              const copie = reponse.clone();
              void caches.open(VERSION).then((cache) => cache.put(requete, copie));
            }
            return reponse;
          }),
      ),
    );
    return;
  }

  // REQ-UI-17 — hors ligne, une navigation retombe sur la coquille précachée : l'app
  // s'ouvre et lit son historique local au lieu d'afficher le dinosaure du navigateur.
  if (requete.mode === "navigate") {
    event.respondWith(fetch(requete).catch(() => caches.match("/").then((r) => r ?? Response.error())));
  }
});
