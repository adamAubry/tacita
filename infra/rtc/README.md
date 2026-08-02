# infra/rtc — chemin voix/vidéo (spec 02)

Config-as-code du backend RTC : SFU LiveKit auto-hébergé, `lk-jwt-service`
(traduit une identité Matrix en jeton d'accès LiveKit), TURN, et la découverte
`.well-known/matrix/client`. Ce module ne livre que l'infra : le client embarque
Element Call en widget (spec 10), il n'y a aucun code RTC maison.

## Démarrage

Overlay du compose de la spec 01, même projet donc même réseau :

```sh
docker compose -f docker-compose.yml -f rtc/docker-compose.yml up -d
```

Variables à remplir dans `.env` en plus de celles de la spec 01 :
`WEB_BIND_IP`, `TURN_BIND_IP`, `TURN_DOMAIN`, `LIVEKIT_KEY`, `LIVEKIT_SECRET`.

| Service | Version | Digest |
|---|---|---|
| livekit-server | v1.13.5 | `sha256:3497163e…` |
| lk-jwt-service | `main` @ 2026-08-02 | `sha256:29918567…` |

`lk-jwt-service` ne publie pas de tag semver amont (uniquement `sha-*` et
`latest-ci_*`) : l'épinglage se fait par digest, à revérifier avant tout bump.

## ⚠️ REQ-RTC-07 — les MSC MatrixRTC ne sont pas stabilisés

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
inerte. Le seul endroit du dépôt qui porte ces littéraux est le bloc
`.well-known` de `proxy/nginx.conf` (REQ-RTC-05) ; la spec 10 les relit côté
client.

## REQ-RTC-04 — la plage UDP s'ouvre en deux endroits

`firewall/host-ufw.sh` (pare-feu de l'hôte) **et**
`firewall/security-group.tf` (groupe de sécurité cloud) déclarent la même plage
`50000-50100/udp`, alignée sur `rtc.port_range_start/end` de `livekit.yaml`. Les
tests échouent si les trois divergent.

**Symptôme d'un oubli** : l'appel se connecte normalement — signalisation,
jetons, affichage des participants, tout a l'air correct — puis **coupe au bout
de 15 à 20 secondes**. C'est ICE qui expire ses candidats : la connexion
initiale passe par le chemin de signalisation, le média jamais. Ça se lit comme
un bug applicatif, c'est une règle de pare-feu manquante d'un côté ou de
l'autre. Vérifier les deux couches avant de chercher ailleurs.

`security-group.tf` cible AWS (`aws_vpc_security_group_ingress_rule`) : c'est la
forme de référence, à transposer si le déploiement part sur un autre
fournisseur. Les ports, eux, ne changent pas.

## REQ-RTC-06 — TURN-TLS sur 443 et deuxième IP publique

Le TURN de dernier recours doit écouter en TLS sur 443 : pour un client derrière
un NAT symétrique ou un pare-feu sortant strict, c'est souvent le seul port
ouvert. Mais le reverse proxy (spec 01) occupe déjà 443.

**Il faut donc deux IP publiques sur l'hôte** : `WEB_BIND_IP` pour le proxy,
`TURN_BIND_IP` pour le TURN. L'overlay épingle chaque service sur la sienne (les
deux variables sont obligatoires, le compose refuse de démarrer sinon). À
défaut, déployer LiveKit sur un hôte dédié et faire pointer les upstreams du
proxy vers lui.

`TURN_DOMAIN` doit correspondre à un SAN du certificat monté depuis
`proxy/certs`. Le script de certs de dev (`proxy/generate-dev-certs.sh`) n'émet
qu'un CN : pour tester le chemin TURN en local, lui ajouter le SAN
correspondant, sinon la négociation TLS du TURN échoue silencieusement et le
client retombe sur les candidats directs.

## Limites assumées

- **Métadonnées d'appel visibles.** Le média est chiffré de bout en bout
  (SFU en relais aveugle), mais le SFU et `lk-jwt-service` voient qui appelle
  qui, quand et combien de temps — même limite que le reste du serveur, voir
  `../LIMITES.md`.
- **TURN relayé = bande passante serveur.** Les clients en NAT symétrique font
  transiter tout leur média par l'hôte. Aucun quota n'est posé en V1.
