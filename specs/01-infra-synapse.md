# SPEC 01 — Infrastructure serveur (Synapse, PostgreSQL, S3, OIDC, reverse proxy)

**Package : `infra/` (hors RTC, voir spec 02). Dépendances : aucune.**

## Livrable

Config-as-code complète et testée du socle serveur auto-hébergé : `homeserver.yaml` Synapse, init PostgreSQL, provider S3, realm OIDC (Keycloak), config reverse proxy. Un `docker-compose.yml` (ou équivalent) démarre l'ensemble. Aucun service tiers ne traite de contenu utilisateur.

## Exigences et critères d'acceptation

- **REQ-INF-01** — PostgreSQL créé avec `LC_COLLATE=C` et `LC_CTYPE=C` (Synapse refuse de démarrer sinon). Le script d'init le garantit.
- **REQ-INF-02** — Fédération désactivée : `federation_domain_whitelist: []`. Application fermée, pas un réseau fédéré.
- **REQ-INF-03** — `encryption_enabled_by_default_for_room_type: all`. (L'activation est irréversible mais non rétroactive : aucun salon ne doit jamais être créé en clair.)
- **REQ-INF-04** — `enable_registration: false` ; script d'admin documenté pour la création manuelle de comptes.
- **REQ-INF-05** — Rate limiting desserré sur `rc_message`, `rc_login`, `rc_joins`, `rc_invites` (valeurs ≥ 10× les défauts ; les défauts provoquent des `M_LIMIT_EXCEEDED` pris pour des bugs applicatifs).
- **REQ-INF-06** — `max_upload_size: 200M` (le défaut 50 Mo est insuffisant pour du partage de fichiers).
- **REQ-INF-07** — Politique de rétention **définie explicitement** dans la config : illimitée, identique DM/groupes (DECISIONS D-02, révisée le 03/08/2026). Le bloc `retention` est présent et commenté, pas absent par omission, avec **`enabled: false`**. Motif, vérifié dans la doc Synapse de la version déployée (v1.155) : `enabled: true` avec `purge_jobs` vide installe un **job de purge quotidien par défaut** (« If no configuration is provided for this option, a single job will be set up to delete expired events in every room daily ») et fait honorer les politiques par salon `m.room.retention` — deux chemins de purge que D-02 proscrit.
- **REQ-INF-08** — Bucket S3 backend média via `s3_storage_provider` ; SSE-S3 activé, **documenté comme défense en profondeur uniquement** (l'opérateur détient ces clés, elles ne protègent pas la confidentialité). Le bucket ne contient que des blobs opaques.
- **REQ-INF-09** — OIDC externe (Keycloak) seul fournisseur d'authentification devant Synapse : email, pseudo et OAuth gérés dans le realm Keycloak ; WebAuthn/passkeys (authentificateur de plateforme) activés dans Keycloak. Matrix ne gère pas nativement plusieurs méthodes par compte : tout passe par le SSO. **Critère de comportement (ajouté le 03/08/2026) : une connexion aboutit** — dans la suite de fumée (`infra/smoke/`), `GET /_matrix/client/v3/login/sso/redirect/oidc-keycloak` redirige vers le realm Keycloak (302), sous un describe nommé `REQ-INF-09`. Les tests de config restent nécessaires mais ne suffisent plus : « module terminé » = tests de config verts ; « produit connectable » = fumée verte. *(Motif : la config était 100 % conforme pendant que personne ne pouvait se connecter.)*
- **REQ-INF-10** — Reverse proxy TLS obligatoire (getUserMedia exige un contexte sécurisé). Routes : `/_matrix` → Synapse, `/livekit/jwt` → service d'autorisation, `/livekit/sfu` → SFU avec upgrade WebSocket.
- **REQ-INF-11** — API d'administration Synapse de join forcé désactivée/bloquée au proxy : un admin ne doit pas pouvoir s'ajouter à un DM et recevoir les clés Megolm suivantes. Les DM sont illisibles par l'administrateur.
- **REQ-INF-12** — Comportement de l'**authenticated media** vérifié sur la version Synapse déployée et consigné dans `infra/README.md` (il a changé récemment et casse les intégrations supposant des URLs média publiques). Le client (spec 08) consomme ce qui est consigné ici.
- **REQ-INF-13** — Doc `infra/LIMITES.md` : métadonnées en clair côté serveur (qui parle à qui, quand, fréquence, taille des pièces jointes) documentées comme limite assumée.
- **REQ-INF-14** — La passerelle Web Push (spec 03) est **provisionnée par ce module** : image construite (Dockerfile), service dans `docker-compose.yml` joignable par Synapse (URL du pusher configurée), route reverse proxy exposant au client l'endpoint de config (clé publique VAPID, REQ-PSH-03), variables `VAPID_*` dans `.env.example`. Critère : `docker compose up` démarre la passerelle. *(Créée le 03/08/2026 — la spec 03 livre le service, la spec 01 possède le raccordement ; personne ne le possédait.)*
- **REQ-INF-15** — Le service de liens d'invitation (spec 12) est **provisionné par ce module**, par la même jurisprudence que REQ-INF-14 : image construite, service dans `docker-compose.yml`, base PostgreSQL dédiée (jamais une table dans celle de Synapse), route reverse proxy, variables dans `.env.example`. **Aucun jeton d'administration Synapse dans son environnement** — la spec 12 lui interdit tout pouvoir Matrix, le raccordement ne doit pas le lui rendre. Critère : `docker compose up` démarre le service, et un test de configuration asserte l'absence de variable portant un secret d'administration. *(Créée le 05/08/2026 — escalade E-05, D-09.)*

## Méthode et contraintes

- Toute valeur par défaut Synapse est lue dans la doc de la version épinglée, jamais supposée. Versions épinglées (digest) dans le compose.
- Hors scope : LiveKit/TURN/well-known (spec 02), tout code client, CI/CD. Le **code** de la passerelle push (spec 03) et celui du service de liens (spec 12) sont hors scope eux aussi — mais pas leurs raccordements, qui sont ici : REQ-INF-14 et REQ-INF-15.

## Objectif mesurable

Suite Vitest dans `infra/tests/` qui parse les fichiers rendus (YAML/JSON) et asserte chaque REQ ci-dessus (une describe par REQ, nommée par son ID) : valeurs exactes de REQ-INF-02/03/04/06, présence des blocs REQ-INF-05/07/08, routes du proxy REQ-INF-10. `pnpm test` vert = module conforme.
