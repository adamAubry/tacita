# infra/rtc — chemin voix/vidéo

Config-as-code du backend RTC : SFU LiveKit auto-hébergé, `lk-jwt-service`
(traduit une identité Matrix en jeton d'accès LiveKit), TURN, et la découverte
`.well-known/matrix/client`. Ce module ne livre que l'infra : le client embarque
Element Call en widget, il n'y a aucun code RTC maison.

## Démarrage

Overlay du compose de `infra`, même projet donc même réseau :

```sh
docker compose -f docker-compose.yml -f rtc/docker-compose.yml up -d
```

Variables à remplir dans `.env` en plus de celles de `infra` : `LIVEKIT_KEY` et
`LIVEKIT_SECRET`, que `pnpm admin init` génère. **Rien d'autre** — pas d'IP à déclarer,
pas de domaine pour le TURN. C'est ce qui permet à [`install.sh`](../../install.sh) de monter cet
overlay à chaque installation, sans question de plus à poser à l'administrateur.

Sur une machine de développement, un overlay de plus :

```sh
docker compose -f docker-compose.yml -f smoke/docker-compose.yml \
               -f rtc/docker-compose.yml -f rtc/dev.docker-compose.yml up -d
```

Il ne fait qu'une chose, et elle corrige une panne muette : `NODE_IP=127.0.0.1` coupe la
découverte STUN de l'IP publique. Sans lui, le SFU annonce une adresse que le navigateur
de la machine ne joindra jamais — l'appel se connecte, affiche les participants, et le
média n'arrive pas. Le symptôme d'un pare-feu fermé, pour la cause opposée.

| Service | Version | Digest |
|---|---|---|
| livekit-server | v1.13.5 | `sha256:3497163e…` |
| lk-jwt-service | `main` @ 2026-08-02 | `sha256:29918567…` |

`lk-jwt-service` ne publie pas de tag semver amont (uniquement `sha-*` et
`latest-ci_*`) : l'épinglage se fait par digest, à revérifier avant tout bump.

## ⚠️ les MSC MatrixRTC ne sont pas stabilisés

Aucune valeur littérale du protocole MatrixRTC ne doit être recopiée de mémoire
ni depuis un billet de blog. **Avant tout usage littéral, relire la doc courante
d'Element Call et de `lk-jwt-service`** :

- le **préfixe d'événement** et la clé de découverte — ici
  `org.matrix.msc4143.rtc_foci` (MSC4143), vérifiée le 2026-08-02 dans le README
  de `element-hq/lk-jwt-service`. Le préfixe `org.matrix.msc*` change à chaque
  révision du MSC et disparaîtra à la stabilisation ;
- la **structure des state keys** des événements d'appartenance à un appel, qui
  a déjà changé plusieurs fois (MSC4143 / MSC4195) ;
- le nom des champs du focus (`type`, `livekit_service_url`).

Une valeur périmée ne casse pas bruyamment : le bouton d'appel reste simplement
inerte. Le seul endroit du dépôt qui porte ces littéraux est [`rtc/well-known.conf`](well-known.conf) ;
[`@tacita/calls`](../../packages/calls) les relit côté client.

## l'annonce du focus appartient à cet overlay

Deux fichiers servent la même route, un seul est monté à la fois :

| Fichier | Monté par | Annonce |
|---|---|---|
| `proxy/well-known.conf` | [`docker-compose.yml`](docker-compose.yml) (pile de base) | `m.homeserver` seul, **aucun focus** |
| `rtc/well-known.conf` | cet overlay | `m.homeserver` + `org.matrix.msc4143.rtc_foci` |

Même point de montage (`/etc/nginx/well-known.conf`) : compose fusionne les volumes
par cible, l'overlay remplace donc le fichier de base au lieu de s'y ajouter.

**Pourquoi ce détour plutôt qu'un `rtc_foci` en dur dans `nginx.conf`** — c'est ce
qu'on faisait avant. Une pile sans SFU annonçait un focus
dont le backend n'existe pas : `discoverFocus()` réussissait, et l'appel mourait en
502 à la connexion au lieu du `RtcFociMissing` que rend affichable. Une
annonce ne doit pas survivre au déploiement qu'elle décrit.

## la plage UDP s'ouvre en deux endroits

[`firewall/host-ufw.sh`](firewall/host-ufw.sh) (pare-feu de l'hôte) **et**
[`firewall/security-group.tf`](firewall/security-group.tf) (groupe de sécurité cloud) déclarent la même plage
`50000-50100/udp`, alignée sur `rtc.port_range_start/end` de [`livekit.yaml`](livekit.yaml) — de même
pour le `5349/tcp` du TURN-TLS et `turn.tls_port`. Les tests échouent si les trois
divergent, et `pnpm admin doctor` lit la même source pour décider quels ports publiés
sont légitimes.

`install.sh` lance `host-ufw.sh` lui-même, en root, avant de démarrer la pile —
mais seulement là où `ufw` existe. Sur une machine protégée autrement, ces règles
restent à reporter à la main : le script le dit alors au lieu de se taire.

**Symptôme d'un oubli** : l'appel se connecte normalement — signalisation,
jetons, affichage des participants, tout a l'air correct — puis **coupe au bout
de 15 à 20 secondes**. C'est ICE qui expire ses candidats : la connexion
initiale passe par le chemin de signalisation, le média jamais. Ça se lit comme
un bug applicatif, c'est une règle de pare-feu manquante d'un côté ou de
l'autre. Vérifier les deux couches avant de chercher ailleurs.

`security-group.tf` cible AWS (`aws_vpc_security_group_ingress_rule`) : c'est la
forme de référence, à transposer si le déploiement part sur un autre
fournisseur. Les ports, eux, ne changent pas.

## TURN-TLS sur 5349, et une seule IPv4

Le TURN de dernier recours écoute en TLS sur **5349**, le port `turns` de l'IANA, sur
l'adresse de l'hôte — celle du proxy. Il n'y a rien à réserver, rien à déclarer.

**Ce n'était pas le cas avant le 26/08/2026**, et le motif d'alors était bon : pour un
client derrière un pare-feu sortant strict, le 443 est souvent le seul port ouvert, donc
le seul par lequel un relais puisse passer. Mais le reverse proxy occupe déjà le 443, ce
qui imposait **deux IPv4 publiques sur l'hôte** — `WEB_BIND_IP` et `TURN_BIND_IP`, toutes
deux obligatoires, l'overlay refusant de démarrer sans elles.

Ce qu'on gagnait sur ce cas de client, on le perdait sur tous les autres : un hôte
auto-hébergé a une adresse, et les appels y étaient tout simplement indéployables. Une
seconde IP se loue, mais elle se loue **avant** de savoir qu'on en a besoin, et personne
ne le découvrait avant le premier appel raté. Le port a donc bougé, et la limite est
maintenant assumée et écrite plus bas.

`turn.domain` vaut `SERVER_NAME` — pas un sous-domaine à lui. Le certificat monté depuis
`proxy/certs` le porte par construction, ce qui retire du chemin d'installation un
enregistrement DNS, un SAN, et le certificat à réémettre le jour où on l'a oublié.

Reste l'alternative de toujours quand la charge le justifie : déployer LiveKit sur un hôte
dédié et faire pointer les upstreams du proxy vers lui.

## Element Call est à nous, donc épinglé

**Version déployée : `v0.23.0`**, image
`ghcr.io/element-hq/element-call@sha256:e352de468647777e3780fec45281e2ccc90da69a828f7a3d88700ff9ac04bb0b`,
digest résolu le **2026-08-07** (le tag `latest` pointait alors sur le même).
**URL servie : `https://call.<SERVER_NAME>`.**

Ces trois lignes ne sont pas décoratives : elles sont ce qui rend relisable ce que
[`packages/calls`](../../packages/calls) écrit dans l'URL du widget. Avant elles, le shard passait un paramètre
de lancement audio/vidéo qu'aucune version ne pouvait confirmer. Ce que
la relecture de `src/UrlParams.ts` de la v0.23.0 a donné :

| Ce que le client envoie | Ce que la v0.23.0 en fait |
| --- | --- |
| `intent=start_call` | appel vidéo, lobby affiché |
| `intent=start_call_voice` | appel audio, lobby affiché |
| `header=none` | en-tête du widget masqué |
| ~~`video=true|false`~~ | **rien — ce paramètre n'existe pas** |
| ~~`hideHeader=true`~~ | **rien — remplacé par `header`** |

Les deux dernières lignes sont l'intérêt de l'exercice : elles étaient écrites de bonne
foi et ne faisaient rien du tout.

**Trois choses à refaire à chaque bump d'image**, dans cet ordre :

1. relire `src/UrlParams.ts` de la nouvelle version — `UserIntent` et `UrlConfiguration`
   sont la source, et les noms y bougent (`hideHeader` → `header` en est la preuve) ;
2. vérifier `MatrixRTCMode` dans `src/config/ConfigOptions.ts`. Notre configuration —
   servie par [`call.conf`](call.conf), voir ci-dessous — épingle `compatibility`. **Ne pas passer à `matrix_2_0`** sans changer d'abord
   `packages/calls` : ce mode active les événements *sticky* de MSC4354, et `activeCall()`
   cesserait de voir les participants **sans erreur bruyante** — le salon afficherait
   simplement « aucun appel ». C'est la divergence que [`packages/calls/README.md`](../../packages/calls/README.md) annonce ;
3. mettre à jour version, digest et date ci-dessus. Un digest non consigné est une
   jonction non relue, quelle que soit la qualité du reste.

**Sa configuration est servie par le proxy, pas écrite dans le conteneur.** L'image tourne
en uid 101 et son `/app` appartient à root : l'overlay y rendait pourtant un `config.json`
par un `sed` au démarrage, qui ne pouvait pas aboutir. Le conteneur sortait en
« Permission denied » avant de lancer nginx, et Docker le relançait toutes les
60 secondes — le plafond de son backoff, ce qui donne l'illusion trompeuse d'un
redémarrage régulier plutôt que d'un échec immédiat.

Personne ne l'avait vu, et c'est la partie instructive : tant que l'overlay exigeait deux
IPv4 publiques, **cet entrypoint n'avait jamais tourné une seule fois**. Les tests de
`rtc/tests/` lisaient sa chaîne dans le YAML et la trouvaient bien formée. Règle 4 :
« module terminé » et « produit qui marche » sont deux portes distinctes.

[`rtc/call.conf`](call.conf) sert donc `/config.json` lui-même, en tirant le nom du homeserver du
domaine de la requête (`server_name ~^call\.(?<homeserver>.+)$`) — le patron de
[`well-known.conf`](well-known.conf), pour la même raison. Le conteneur reste celui d'amont : aucun
entrypoint, aucun volume, aucune variable, et rien à écrire au démarrage.

Le certificat monté depuis `proxy/certs` doit porter un **SAN pour `call.<SERVER_NAME>`**.
Sans lui, l'iframe échoue au TLS et le shard n'affiche que son délai de chargement, sans
pouvoir en donner la cause. C'est le seul nom que le RTC ajoute au certificat, et il y est
depuis l'émission : `pnpm admin certificat` le passe à certbot, `generate-dev-certs.sh` le
met en SAN.

## Limites assumées

- **Métadonnées d'appel visibles.** Le média est chiffré de bout en bout
  (SFU en relais aveugle), mais le SFU et `lk-jwt-service` voient qui appelle
  qui, quand et combien de temps — même limite que le reste du serveur, voir
  [`../README.md`](../README.md).
- **Un client à la fois derrière un NAT symétrique et un pare-feu sortant qui ne laisse
  passer que le 443 ne joint pas le TURN**, qui écoute sur 5349. Il lui reste l'UDP
  50000-50100 et le repli ICE/TCP 7881 ; c'est la conjonction des deux qui perd le relais,
  pas l'un des deux. Contrepartie assumée du fait que les appels se déploient partout
  ailleurs — motif complet ci-dessus.
- **TURN relayé = bande passante serveur.** Les clients en NAT symétrique font
  transiter tout leur média par l'hôte. Aucun quota n'est posé en V1.
