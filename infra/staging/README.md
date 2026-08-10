# Staging — configurer le VPS Ubuntu

Runbook de la machine de staging : de l'image Ubuntu nue à une pile joignable depuis un
téléphone. REQ-INF-17.

Le pendant local est `infra/README.md` (le socle) et le runbook de dev de la machine de
développement. Ici, rien n'est machine-dépendant : ce fichier est le contrat de
l'environnement, il doit rester rejouable sur un VPS neuf.

---

## 0. Ce que cet environnement est — et ce qu'il n'est pas

**Staging, pas production.** Il se jette et se reconstruit. Il n'y a donc **aucune
sauvegarde**, et ce n'est pas un oubli : une donnée qui ne survit pas à un `down -v` ici
est une donnée qu'on accepte de perdre. Ne jamais y mettre de conversation qu'on tient à
garder.

Ce qui marchera pour la première fois ici, et qui n'a jamais pu marcher en local :

|                                                       |                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| ✅ Un vrai certificat, donc un vrai contexte sécurisé | service worker, PWA installable, `crypto.subtle`                                                                                           |
| ✅ Ouvrir l'application depuis un téléphone           | plus besoin d'un fichier hosts ni d'un CA importé                                                                                          |
| ⚠️ **Push notifications**                             | la chaîne est complète pour la première fois ; **rien n'a jamais été délivré de bout en bout**, c'est ici que ça se prouve ou que ça tombe |
| ❌ **Appels audio/vidéo**                             | l'overlay `rtc/` exige deux IPv4 publiques (REQ-RTC-06), voir § 9                                                                          |

L'absence d'appels est **attendue et annoncée correctement** : sans overlay RTC, le
`.well-known` n'annonce aucun focus (REQ-RTC-05) et l'UI affiche `RtcFociMissing` plutôt
qu'un appel qui se charge puis meurt.

---

## 1. La machine

|        |                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| OS     | Ubuntu 24.04 LTS                                                                                                 |
| RAM    | **8 Go recommandé, 4 Go le plancher.** `next build` et le build de l'image Synapse tournent sur la machine (§ 6) |
| Disque | 40 Go                                                                                                            |
| IPv4   | 1 suffit pour tout sauf les appels — voir § 9 avant de commander                                                 |

Sous 4 Go, ajouter du swap **avant** le premier build, sinon le compilateur se fait tuer
par l'OOM killer et le message ne dit pas que c'est la mémoire :

```sh
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 2. DNS

Deux enregistrements `A` vers l'IPv4 du VPS :

```
chat.<domaine>        A    <IP du VPS>
call.chat.<domaine>   A    <IP du VPS>
```

`SERVER_NAME` sera `chat.<domaine>`. **Ce nom est définitif.** Il entre dans chaque
identifiant Matrix (`@moi:chat.<domaine>`), dans chaque clé de salon et dans chaque
signature d'appareil : le changer ne renomme rien, il crée un autre homeserver et
abandonne l'ancien. Le choisir maintenant, une fois.

`call.chat.<domaine>` est Element Call (REQ-RTC-08), servi par nous. Le déclarer
maintenant même sans overlay RTC : le certificat doit le couvrir dès l'émission, sinon
il faut le réémettre au moment où on branche les appels.

Vérifier avant d'aller plus loin — la propagation prend le temps qu'elle prend, et
certbot échouera sans rien dire d'utile si le nom ne résout pas encore :

```sh
dig +short chat.<domaine> call.chat.<domaine>
```

---

## 3. Système

```sh
# Utilisateur non-root, membre du groupe docker
sudo adduser tacita && sudo usermod -aG docker tacita

# Docker Engine + plugin compose (dépôt officiel, pas le paquet Ubuntu qui est ancien)
curl -fsSL https://get.docker.com | sudo sh

sudo apt update && sudo apt install -y certbot git
```

### Pare-feu

```sh
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # certbot --standalone, à l'émission et à chaque renouvellement
sudo ufw allow 443/tcp    # le proxy
sudo ufw enable
```

⚠️ **ufw ne protège pas les ports publiés par Docker.** Docker écrit ses règles de
redirection en amont de la chaîne que ufw contrôle : un `ports:` dans un compose est
ouvert sur Internet même si ufw dit le contraire. Ce n'est pas un problème ici — la pile
de base ne publie que 443 — mais c'est la raison pour laquelle l'overlay de staging
n'ajoute **aucun** `ports:`, et un test le vérifie. C'est aussi pourquoi
`smoke/docker-compose.yml` ne doit jamais être chargé sur cette machine : il publie
PostgreSQL et l'API Synapse, ufw ou pas.

Rien n'écoute sur 80 : nginx ne s'y lie pas. Le port est ouvert pour certbot seul.

---

## 4. Le dépôt et le certificat

```sh
sudo install -d -o tacita -g tacita /opt/tacita
git clone <url-du-dépôt> /opt/tacita && cd /opt/tacita
```

Poser le hook de renouvellement **avant** d'émettre le certificat : certbot exécute les
hooks de déploiement dès la première émission, ce qui met les fichiers en place tout seul.

```sh
cd /opt/tacita
sudo install -D -m 755 infra/staging/certs-deploy-hook.sh \
  /etc/letsencrypt/renewal-hooks/deploy/tacita.sh
```

`-D` n'est pas décoratif : `/etc/letsencrypt/renewal-hooks/deploy/` n'existe pas tant que
certbot n'a jamais tourné, et sans lui `install` échoue sur un « No such file or
directory » qui nomme la destination — pas le script du dépôt.

```sh
sudo certbot certonly --standalone \
  -d chat.spleen.blog -d call.chat.spleen.blog \
  --agree-tos -m <ton-email> --no-eff-email
```

`--standalone` et non `--nginx` : notre nginx tourne dans un conteneur, avec une
configuration montée en lecture seule, et il n'écoute pas sur 80. Certbot lie lui-même le
80 le temps du défi, ce qui ne dérange rien.

Le hook recopie `fullchain.pem` et `privkey.pem` dans `infra/proxy/certs/` — le répertoire
que la pile de base monte dans le proxy — puis recharge nginx. Le pourquoi de la recopie
plutôt que d'un montage est dans le script ; en deux mots, les liens de `live/` sont
relatifs et se cassent à la première rotation.

🚫 **Ne jamais lancer `infra/proxy/generate-dev-certs.sh` sur cette machine.** Il écrit
aux mêmes chemins et remplacerait le certificat Let's Encrypt par un auto-signé. Le
symptôme serait une erreur TLS sur tous les clients à la fois, y compris les téléphones
déjà appairés.

Vérifier que le renouvellement automatique est armé (`certbot.timer` est installé par le
paquet) :

```sh
systemctl list-timers certbot.timer
sudo certbot renew --dry-run
```

---

## 5. `infra/.env`

```sh
cp infra/.env.example infra/.env
```

Les valeurs qui **doivent** changer par rapport à l'exemple :

| Variable                                                                                                        | Valeur                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `SERVER_NAME`                                                                                                   | `chat.<domaine>`                                                                               |
| `SHARD_ORIGIN`                                                                                                  | **vide** — REQ-INF-16, le shard est servi sur le même domaine, il n'y a pas d'origine à ouvrir |
| `SYNAPSE_IP_RANGE_WHITELIST`                                                                                    | `["172.16.0.0/12"]` — obligatoire, voir ci-dessous                                             |
| `POSTGRES_PASSWORD`, `SYNAPSE_*_SECRET*`, `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_OIDC_CLIENT_SECRET`, `S3_*_KEY*` | `openssl rand -hex 32` pour chacun, jamais deux fois la même                                   |
| `MINIO_KMS_SECRET_KEY`                                                                                          | `echo "tacita-staging:$(openssl rand -base64 32)"`                                             |
| `VAPID_SUBJECT`                                                                                                 | `mailto:<ton-email>`                                                                           |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`                                                                        | voir ci-dessous                                                                                |
| `TURN_DOMAIN`, `WEB_BIND_IP`, `TURN_BIND_IP`                                                                    | laisser tel quel : l'overlay RTC n'est pas chargé (§ 9)                                        |

`SYNAPSE_IP_RANGE_WHITELIST` n'est pas facultatif ici. L'overlay pose un alias réseau qui
fait résoudre `SERVER_NAME` vers le proxy depuis l'intérieur du compose (levier de D-07,
plus fiable que de compter sur le hairpin NAT du fournisseur). L'adresse obtenue est
privée, et Synapse refuse par défaut ses propres requêtes sortantes vers les plages
privées — protection SSRF. Sans la whitelist, la découverte OIDC échoue et **tout login
répond 503**, sans que rien ne nomme la cause.

Les clés VAPID, sans installer Node sur la machine :

```sh
docker run --rm node:22-alpine npx -y web-push generate-vapid-keys
```

`infra/.env` est ignoré par git et ne doit jamais y entrer. Il n'existe qu'ici.

---

## 6. Premier démarrage

```sh
cd /opt/tacita/infra
docker compose -f docker-compose.yml -f staging/docker-compose.yml up -d --build
```

**Les deux fichiers, toujours** — et **jamais** avec `smoke/docker-compose.yml` (§ 3).

Le premier `--build` construit le shard : `pnpm install` puis `next build`, plusieurs
minutes, et c'est là que 4 Go de RAM se sentent.

```sh
docker compose -f docker-compose.yml -f staging/docker-compose.yml ps
```

Attendu : `postgres`, `keycloak`, `minio`, `synapse` en `healthy` ; `proxy`, `web`,
`push-gateway`, `invite-tokens` en `Up` ; `minio-init` sorti en 0 (c'est un job).

Laisser Keycloak importer son realm — une quinzaine de secondes — avant de juger quoi que
ce soit. Le `depends_on: healthy` du compose est là pour ça : Synapse met en cache l'échec
de découverte OIDC s'il interroge trop tôt, et ne s'en remet pas sans redémarrage.

### Contrôle de pré-vol — D-07

**Une seule commande a valeur de preuve**, et elle doit passer avant toute création de
compte. Elle traverse le proxy, Synapse, et surtout la découverte OIDC faite par Synapse
lui-même :

```sh
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
  "https://chat.<domaine>/_matrix/client/v3/login/sso/redirect/oidc-keycloak?redirectUrl=https://chat.<domaine>/"
```

Attendu : `302 ->` l'URL d'autorisation du realm, avec `code_challenge_method=S256`. Un
**503** signifie que Synapse n'a pas pu lire
`https://chat.<domaine>/auth/realms/tacita/.well-known/openid-configuration` depuis sa
propre position réseau — dans l'ordre : alias réseau, `SYNAPSE_IP_RANGE_WHITELIST`,
Keycloak pas encore prêt au démarrage de Synapse (`docker compose restart synapse`).

Ce 302 **est** la preuve, parce que le chemin qu'il emprunte est celui du client HTTP de
Synapse (Twisted). Interroger la même URL depuis un autre outil dans le conteneur
prouverait un chemin que Synapse n'emprunte pas — c'est la règle 3 de `specs/00-conventions.md`,
et elle a déjà coûté une journée sur ce dépôt.

Puis, depuis un navigateur : `https://chat.<domaine>` doit servir le shard.

---

## 7. Les comptes

### Fermer l'auto-inscription — à faire au premier démarrage

`registrationAllowed` ouvre le formulaire « New user? Register » de Keycloak. C'est
confortable en local — et **inacceptable sur une machine publique** : n'importe qui se
crée un compte sur le staging. La valeur de `keycloak/realm-export.json` suit ce dont la
machine de développement a eu besoin ; ne pas s'y fier, la fermer ici explicitement.

```sh
cd /opt/tacita/infra && source .env
C="docker compose -f docker-compose.yml -f staging/docker-compose.yml exec keycloak /opt/keycloak/bin/kcadm.sh"

$C config credentials --server http://localhost:8080/auth --realm master \
  --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"
$C update realms/tacita -s registrationAllowed=false
```

Le `/auth` dans `--server` n'est pas optionnel : `KC_HTTP_RELATIVE_PATH` déplace toute
l'API, et sans le préfixe `kcadm.sh` répond `404 Not Found` sans dire pourquoi.

⚠️ **Le realm n'est importé qu'au premier démarrage du volume Keycloak.** Modifier
`keycloak/realm-export.json` plus tard ne change rien à la machine ; il faut passer par
`kcadm.sh` ou l'admin (`https://chat.<domaine>/auth/admin`).

### Créer un compte de test

```sh
$C create users -r tacita -s username=adam -s enabled=true \
  -s email=adam@<domaine> -s emailVerified=true
$C set-password -r tacita --username adam --new-password '<mot-de-passe>'
```

Le pseudo devient le localpart Matrix tel quel (`adam` → `@adam:chat.<domaine>`) : pas de
majuscule, pas de `@`, sinon c'est le retour de `/oidc/callback` qui échoue, pas le
formulaire. Le compte Matrix est provisionné par Synapse au premier login SSO —
`enable_registration: false` (REQ-INF-04) ne gate que l'inscription par mot de passe.

Ne pas utiliser `register_new_matrix_user` : il crée un compte à mot de passe, qui ne
pourra jamais se connecter puisque `password_config.enabled` est `false` (REQ-UI-04).

Au premier écran après connexion, **la clé de récupération est bloquante et c'est voulu**
(REQ-COR-06 / D-08) : sans elle le cross-signing n'est pas amorcé et le compte ne peut pas
chiffrer. La noter, l'écran ne la remontre pas.

---

## 8. Déployer une nouvelle version

```sh
cd /opt/tacita && git pull
cd infra && docker compose -f docker-compose.yml -f staging/docker-compose.yml up -d --build
```

`--build` à chaque fois : les trois images du dépôt (shard, passerelle push, service de
liens) sont construites localement, et sans le drapeau compose réutilise l'ancienne.

Pour arrêter sans rien perdre :

```sh
docker compose -f docker-compose.yml -f staging/docker-compose.yml stop
```

`stop`, jamais `down -v` : les volumes portent les comptes Keycloak, la base Synapse, les
médias — et **la clé de signature du homeserver**, dont la perte invalide toutes les
sessions et tous les appareils appairés. La base `invite_tokens` n'est créée qu'à la
première initialisation du volume PostgreSQL (REQ-INF-15) ; la reperdre demande de la
recréer à la main.

---

## 9. Les appels — ce qu'il faudra en plus

L'overlay `rtc/docker-compose.yml` **refuse de démarrer** sans `WEB_BIND_IP` et
`TURN_BIND_IP`, et c'est délibéré : le TURN de dernier recours doit écouter en TLS sur le
443 (REQ-RTC-06, souvent le seul port sortant ouvert derrière un NAT strict), or le proxy
occupe déjà ce port. **Il faut donc une deuxième IPv4 sur la machine** — quelques euros
par mois chez la plupart des hébergeurs. L'alternative documentée dans `rtc/README.md` est
un hôte dédié à LiveKit.

Quand la deuxième IP est là : ajouter `turn.chat.<domaine>` au DNS, réémettre le
certificat avec ce nom en plus, remplir les trois variables, ouvrir les ports du pare-feu
(`rtc/firewall/` en est le miroir de référence — ouvrir d'un côté sans l'autre donne un
appel qui se connecte puis **coupe à 15-20 secondes**), et charger l'overlay :

```sh
docker compose -f docker-compose.yml -f staging/docker-compose.yml -f rtc/docker-compose.yml up -d
```

---

## 10. Dépannage — symptôme vers cause

| Symptôme                                                                 | Cause                                                                                                                    | Où       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| `503` sur `/login/sso/redirect`                                          | Synapse n'atteint pas la découverte OIDC : alias, `SYNAPSE_IP_RANGE_WHITELIST`, ou Keycloak démarré après lui            | § 5, § 6 |
| Formulaire Keycloak OK puis blocage sur `/_synapse/client/oidc/callback` | `SHARD_ORIGIN` non vide alors que le shard est servi sur `SERVER_NAME`                                                   | § 5      |
| `502` sur `/` seul, le reste répond                                      | le service `web` n'est pas monté, ou l'image n'écoute pas sur `0.0.0.0`                                                  | § 6      |
| Erreur TLS sur tous les clients d'un coup                                | `generate-dev-certs.sh` lancé sur la machine                                                                             | § 4      |
| Le certificat expire malgré `certbot.timer`                              | hook de déploiement absent ou non exécutable                                                                             | § 4      |
| `install` : « No such file or directory » à la pose du hook              | destination nommée → `renewal-hooks/deploy/` pas encore créé, utiliser `-D` ; source nommée → mauvais répertoire courant | § 4      |
| Le build est tué sans message                                            | mémoire : ajouter du swap                                                                                                | § 1      |
| `kcadm.sh` répond `404 Not Found`                                        | `--server` sans `/auth`                                                                                                  | § 7      |
| Une modification de `realm-export.json` n'a aucun effet                  | le realm n'est importé qu'au premier démarrage du volume                                                                 | § 7      |
| `RtcFociMissing` à l'écran d'appel                                       | pile sans SFU — attendu ici                                                                                              | § 9      |
| Aucune notification push ne parvient                                     | jamais délivré de bout en bout à ce jour ; c'est l'inconnue de cet environnement                                         | § 0      |

Pour ce qui ressemble à une limite du produit plutôt qu'à une panne, la liste « Ce qui
n'est pas prouvé » d'`apps/web/README.md` fait foi, et `infra/LIMITES.md` porte les
limites assumées du socle.
