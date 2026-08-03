# infra — socle serveur (spec 01)

Config-as-code : PostgreSQL, Synapse, Keycloak (OIDC + WebAuthn), MinIO (S3),
reverse proxy nginx. Hors scope : LiveKit/TURN/well-known (spec 02), passerelle
push (spec 03).

## Démarrage

```sh
cp .env.example .env        # remplir les secrets
./proxy/generate-dev-certs.sh   # certs auto-signés, dev uniquement
docker compose up -d
```

Création d'un compte (REQ-INF-04 — inscription fermée) :

```sh
docker compose exec synapse register_new_matrix_user \
  -c /data/homeserver.yaml http://localhost:8008
```

## Versions épinglées

| Service | Version | Digest |
|---|---|---|
| Synapse | v1.155.0 (2026-06-16) | `sha256:a87d002f…` |
| PostgreSQL | 16 | `sha256:33f923b0…` |
| Keycloak | 26.7.0 | `sha256:0f198be2…` |
| nginx | 1.27-alpine | `sha256:65645c7b…` |
| MinIO | RELEASE.2025-09-07 | `sha256:14cea493…` |

Digests complets dans `docker-compose.yml`, résolus via `docker buildx imagetools
inspect` au moment de l'écriture (2026-08-02) — à revérifier avant tout bump de
version.

**MinIO** : dernière image publiée en septembre 2025, le dépôt upstream a été
archivé début 2026 (plus de mises à jour de sécurité). Convient pour le dev
local ; en production, pointer `s3_storage_provider` vers un vrai bucket
S3-compatible maintenu (OVH, Scaleway, AWS) via les mêmes variables d'env.

## REQ-INF-12 — authenticated media (Synapse v1.155.0)

Vérifié dans le changelog Synapse : `enable_authenticated_media` est passé à
`true` par défaut en **v1.139.0** (2024-09), et depuis **v1.146.0** les
anciens endpoints non authentifiés (`/_matrix/media/v3/download`,
`/_matrix/media/v3/thumbnail`) répondent **404** — ils ne sont plus un simple
fallback dépréciés mais deux voies mortes.

Conséquence pour le client (spec 08, spec 11) : tout accès média — y compris
le téléchargement du blob chiffré opaque — doit passer par les endpoints
authentifiés (`/_matrix/client/v1/media/download/{serverName}/{mediaId}` et
variante thumbnail) avec l'access token en en-tête. Aucune URL média publique
ne doit être supposée. (Rappel : les vignettes de média chiffré ne sont de
toute façon jamais demandées au serveur — REQ-MED-03, spec 08.)

## Login OIDC — trois causes qui l'empêchent en local, une non résolue

Trouvé en montant la cible de fumée (arbitrage PM, point 9). **Le flux de login n'avait
jamais été exécuté** : les tests de REQ-INF-09 assertent que le YAML déclare le provider
et désactive les mots de passe, pas qu'une connexion aboutit. Elle n'aboutit pas.

Symptôme unique et trompeur pour les trois causes : `GET /_matrix/client/v3/login/sso/redirect/…`
répond **503 « Authentication failed »**, et les logs ne montrent qu'un `OidcDiscoveryError`.
Synapse lit la découverte OIDC sur `https://${SERVER_NAME}/auth/realms/tacita/…`, donc il doit
joindre le proxy par le nom public.

1. **Le nom ne résout pas depuis le réseau Docker.** Corrigé par un alias réseau sur le proxy
   (`smoke/docker-compose.yml`).
2. **Synapse bloque ses propres requêtes vers les plages privées.** `ip_range_blacklist` contient
   `172.16.0.0/12` par défaut, et l'alias fait résoudre le nom vers le proxy, qui y est. D'où le
   réglage `SYNAPSE_IP_RANGE_WHITELIST`, **vide par défaut** : la protection reste entière tant que
   le déploiement n'en a pas besoin. Le symptôme du blocage est un timeout muet, rien dans les logs
   ne mentionne le blocage.
3. **Le certificat auto-signé n'est pas approuvé — non résolu.** `SSL_CERT_FILE` ne suffit pas :
   c'est une convention du module `ssl` de Python, et le client HTTP de Synapse est **Twisted**, qui
   charge sa racine de confiance depuis le magasin OpenSSL du système. Vérifié dans le conteneur.
   Le correctif serait d'installer le certificat de dev dans `/usr/local/share/ca-certificates/`
   puis `update-ca-certificates` — donc une modification de l'image, à arbitrer.

**Ce que ça dit pour la production**, indépendamment du dev : si le déploiement résout
`SERVER_NAME` vers une adresse interne (hairpin NAT absent, DNS split-horizon), les causes 1 et 2
s'appliquent telles quelles. Si `SERVER_NAME` résout publiquement, aucune des trois ne se pose.
**À trancher : quel est le mode de résolution visé ?**

## REQ-INF-05 — rate limiting

Défauts relevés dans la doc v1.155.0, configurés ici à ≥ 10× (voir
`synapse/homeserver.yaml.tmpl` pour les valeurs exactes et leurs commentaires
en regard de chaque défaut).

## Rendu des templates

- `synapse/homeserver.yaml.tmpl` : l'image officielle Synapse ne fait que
  vérifier l'existence du fichier de config, elle ne substitue aucune
  variable — `synapse/entrypoint.sh` rend le template via `envsubst` au
  démarrage du conteneur.
- `keycloak/realm-export.json` : Keycloak substitue nativement les
  `${VAR}` d'un realm importé à partir de son propre environnement (pas de
  rendu maison nécessaire), voir la doc Keycloak « Import/Export ».

## REQ-INF-09 — OIDC / Keycloak

Synapse ne gère pas plusieurs méthodes d'auth nativement : `password_config.enabled: false`,
seul le provider OIDC `keycloak` est actif. Le realm importé active WebAuthn
« passwordless » (authentificateur de plateforme, résident key requise) comme
required action optionnelle — l'utilisateur peut l'activer depuis son compte
Keycloak.
