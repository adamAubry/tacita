# infra — socle serveur (spec 01)

Config-as-code : PostgreSQL, Synapse, Keycloak (OIDC + WebAuthn), MinIO (S3),
reverse proxy nginx, et le **raccordement** de la passerelle Web Push (REQ-INF-14).
Hors scope : LiveKit/TURN/well-known (spec 02), le *code* de la passerelle push
(spec 03).

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
| push-gateway (base Node) | 22-alpine | **non épinglé** — voir ci-dessous |

**Le seul écart à la règle des digests** : `apps/push-gateway/Dockerfile` part de
`node:22-alpine` par tag. Résoudre le digest (`docker buildx imagetools inspect
node:22-alpine`) et le reporter dans le Dockerfile et ce tableau **avant tout
déploiement**.

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

## REQ-INF-14 — passerelle Web Push

Le service de la spec 03 est construit et démarré par ce compose. Il n'a **aucun
port publié** : `/_matrix/push/v1/notify` n'a pas d'authentification (la
subscription complète arrive dans le payload de Synapse), et le publier sur
l'hôte ferait de la passerelle un relais de push ouvert. Seule sort la clé
publique VAPID, par le proxy.

**Ce que le client (spec 11) doit faire :**

1. Lire la clé publique sur `https://<SERVER_NAME>/push/config` →
   `{"vapid_public_key": "…"}`.
2. S'abonner au Web Push du navigateur avec cette clé.
3. Enregistrer le pusher auprès de Synapse, `POST /_matrix/client/v3/pushers` :

```json
{
  "kind": "http",
  "app_id": "org.tacita.web",
  "pushkey": "<endpoint de la PushSubscription>",
  "app_display_name": "Tacita",
  "device_display_name": "Navigateur",
  "lang": "fr",
  "data": {
    "url": "http://push-gateway:8008/_matrix/push/v1/notify",
    "format": "event_id_only",
    "p256dh": "<clé p256dh de la subscription>",
    "auth": "<clé auth de la subscription>"
  }
}
```

L'URL du pusher est **le nom interne du service**, pas une URL publique : c'est
Synapse qui appelle cette URL, depuis le réseau du compose. Passer par le proxy
public ferait sortir puis rentrer la requête pour rien, et obligerait à exposer
un endpoint sans authentification.

`p256dh` et `auth` sont les clés de la `PushSubscription` du navigateur ; la
passerelle en a besoin pour chiffrer le push (sans elles, elle rejette la
pushkey — REQ-PSH-01).

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
