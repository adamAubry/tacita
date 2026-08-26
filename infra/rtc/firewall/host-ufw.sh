#!/bin/sh
# pare-feu de l'hôte. Miroir obligatoire de security-group.tf :
# n'ouvrir qu'une des deux couches est le mode d'échec le plus courant, et le
# plus trompeur (voir ../README.md — l'appel se connecte, puis coupe à 15-20 s).
# ufw est idempotent : rejouer le script ne duplique pas les règles.
set -eu

# média WebRTC — doit rester identique à rtc.port_range_start/end de livekit.yaml
ufw allow 50000:50100/udp comment 'LiveKit media'

# repli ICE/TCP quand l'UDP sortant du client est bloqué
ufw allow 7881/tcp comment 'LiveKit ICE/TCP'

# TURN : UDP standard, et TLS sur 5349 (le port `turns` de l'IANA)
ufw allow 3478/udp comment 'LiveKit TURN'
ufw allow 5349/tcp comment 'LiveKit TURN-TLS'

# le proxy, seul sur le 443 depuis que le TURN-TLS a pris le 5349
ufw allow 443/tcp comment 'HTTPS (`infra`/02)'
