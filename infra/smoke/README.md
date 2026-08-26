# Cible de fumée

Arbitrage PM du 03/08/2026, point 9. **Une seule cible**, pas une suite : elle vérifie
que nos packages tiennent contre une pile réelle, pas contre des mocks.

```sh
cd infra
cp .env.example .env                       # remplir les secrets
./proxy/generate-dev-certs.sh
docker compose -f docker-compose.yml -f smoke/docker-compose.yml up -d

cd .. && npm run smoke
```

## Le parcours d'entrée — `onboarding.smoke.test.ts`

Ajoutée le 25/08/2026, après un défaut que 1039 tests verts n'ont pas vu : une connexion
par identifiant et mot de passe tombait sur « Entrez votre clé de récupération ». Les deux
causes étaient invisibles sur mocks — un magasin crypto local qui garde sa vue d'avant la
signature, et une clé 4S tirée au hasard qu'aucune connexion suivante ne pouvait retrouver.

Elle joue le parcours entier contre la pile réelle : créer un compte, créer sa clé, se
reconnecter **sur un disque neuf** (donc un `device_id` neuf, donc le cas qui cassait), et
entrer par la porte de secours de D-14. Chacune des trois étapes doit finir sur `prete`.

## Connexion sans e-mail

Demande la pile debout (`docker compose up -d postgres keycloak`).

```sh
cd infra
sh smoke/connexion-sans-email.sh
```

Tranche la question que la configuration seule ne pouvait pas trancher : **les codes de
secours de Keycloak peuvent-ils remplacer le mot de passe ?** Mesuré ici — oui. La cible
enrôle un utilisateur jetable, se connecte avec un code sans jamais donner le mot de passe,
vérifie que le code est à usage unique, puis supprime l'utilisateur.

C'est ce qui rend la suppression de l'e-mail tenable : sans elle, un mot de passe perdu
n'aurait plus aucun chemin de retour côté utilisateur.

## Le thème de connexion Keycloak

Demande la pile debout (`docker compose up -d postgres keycloak`).

```sh
cd infra
sh smoke/theme-keycloak.sh
```

Il vérifie que Keycloak **sert** le thème, pas seulement qu'il est bien écrit : feuille liée
*et* servie, feuille du parent conservée, page en français, dictionnaire appliqué, logo éteint.

**Le piège qu'il a trouvé.** `start --import-realm` n'importe un realm que s'il n'existe pas
déjà. Sur une pile ayant déjà démarré, modifier `keycloak/realm-export.json` — `loginTheme`
compris — n'a **aucun effet**, sans erreur ni log. Réimporter, ou mettre à jour le realm :

```sh
docker compose exec keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080/auth --realm master \
  --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"
docker compose exec keycloak /opt/keycloak/bin/kcadm.sh update realms/tacita \
  -s loginTheme=tacita -s displayNameHtml=Tacita \
  -s internationalizationEnabled=true -s defaultLocale=fr -s 'supportedLocales=["fr"]'
```

## Le rendu des gabarits SSO

Séparé de la cible ci-dessus : il n'a besoin d'aucune pile debout, seulement de l'image
Synapse épinglée, parce qu'il emprunte son Jinja.

```sh
cd infra
docker compose run --rm --no-deps -T --entrypoint python3 synapse - < smoke/rendu-gabarits.py
```

Il rend les six pages de `synapse/templates/` — les quatre branches de `sso_error`, et le
compte sans nom d'affichage — et vérifie ce que la lecture de source ne peut pas voir :
que le Jinja compile, que la feuille est bien incluse, que `postMessage("authDone")`
survit au rendu, et que `error_description`, qui vient d'un tiers, est échappé.

## Ce qu'elle prouve, et que 189 tests ne prouvaient pas

- **La crypto Rust réellement chargée** : `getVersion()` doit dire vodozemac, pas la
  config qui l'annonce.
- **Un salon effectivement chiffré côté serveur** : l'événement d'état est enregistré
  et le SDK le voit — pas « la config dit que ça devrait ».
- **Le tour complet du chiffrement** : chiffré sur l'appareil, stocké par Synapse,
  rendu par `/sync`, déchiffré ici. On assère aussi que ce que Synapse a stocké est
  bien `m.room.encrypted` et ne contient pas le texte.
- **La reprise de session** : objets neufs, même IndexedDB, aucun jeton fourni. La
  session se rouvre, garde le même `device_id`, et l'historique reste déchiffrable
.

- **Que le login OIDC aboutit** (`login.smoke.test.ts`) : Synapse redirige
  vers le realm Keycloak, avec PKCE. C'est la découverte OIDC qui était cassée — quatre
  causes, documentées dans `../README.md` — et c'est elle que la redirection prouve.

- **Que la consommation d'un lien d'invitation est atomique**
  (`invite-tokens.smoke.test.ts`) : deux résolutions concurrentes du dernier
  usage, **arbitrées par PostgreSQL**. La suite par défaut ne peut pas le prouver — son
  imitation de la base est monothread, donc atomique par construction, et une imitation
  qui confirme l'hypothèse par construction ne l'éprouve pas. Elle y asserte la forme de
  l'instruction SQL ; ici, on l'exécute.

- **Que l'annuaire répond à qui ne partage rien** (`annuaire.smoke.test.ts`,
) : deux comptes créés pour l'occasion, aucun salon en commun, et l'un
  trouve l'autre par un fragment de son nom d'affichage. Le test de config atteste que
  `search_all_users: true` est écrit dans le fichier ; il n'atteste pas qu'une recherche
  aboutisse — c'est exactement l'écart qui a produit E-21, où le réglage par défaut était
  conforme à une spec muette pendant que « Ajouter un ami » ne trouvait personne.
  Éprouvé le 21/08/2026 dans les deux sens : avec `search_all_users: false`, les deux
  assertions d'annuaire échouent et seul le chemin du profil (adresse exacte) répond.

## Ce qu'elle ne couvre pas

**Le flux de login complet.** La cible s'arrête à la redirection vers Keycloak : aller
plus loin exigerait de piloter un formulaire HTML, donc un navigateur, donc Playwright —
interdit. Le jeton des tests de session vient donc du secret partagé de, pas
du flux SSO.

`semerCredentials` (dans `harness.ts`, une seule copie pour les quatre cibles qui ouvrent
une session) est le seul endroit où la cible triche, et exactement du montant de ce
qui reste : en production ces trois valeurs viennent de `initSession()` après le SSO.

## Pourquoi elle est hors de la suite par défaut

Elle exige Docker debout. Le hook de pré-commit lance la suite complète à chaque
commit ; l'y inclure la casserait pour tout le monde. D'où une config à part
(`vitest.config.ts` ici), un suffixe distinct (`*.smoke.test.ts`) et l'exclusion de
`smoke/**` dans `../vitest.config.ts`.

## L'overlay

`docker-compose.yml` de ce dossier ne contient que des écarts dev/prod, D-07 :
alias réseau pour résoudre `SERVER_NAME` en interne, confiance dans le certificat
auto-signé, `SYNAPSE_IP_RANGE_WHITELIST`, et le port de Synapse publié sur la boucle
locale (l'API d'admin est bloquée au proxy). Aucun artefact de production
n'est modifié.

## Ce qu'elle a déjà trouvé

Au premier lancement, un bug réel dans `client-core` : `IndexedDBStore.startup()` était
appelé **avant** l'affectation du store au client. Sur une base vierge l'ordre inverse
passe — donc un premier lancement marchait, et la suite sur mocks aussi. Seule la
reprise de session échouait, systématiquement. Le code venait de `@tacita/client-core` d'origine :
le défaut était sur `main` depuis le début.
