#!/bin/sh
# REQ-RTC-04 — pare-feu de l'hôte. Miroir obligatoire de security-group.tf :
# n'ouvrir qu'une des deux couches est le mode d'échec le plus courant, et le
# plus trompeur (voir ../README.md — l'appel se connecte, puis coupe à 15-20 s).
# ufw est idempotent : rejouer le script ne duplique pas les règles.
set -eu

# média WebRTC — doit rester identique à rtc.port_range_start/end de livekit.yaml
ufw allow 50000:50100/udp comment 'LiveKit media (spec 02)'

# repli ICE/TCP quand l'UDP sortant du client est bloqué
ufw allow 7881/tcp comment 'LiveKit ICE/TCP (spec 02)'

# REQ-RTC-06 — TURN : UDP standard, et TLS sur 443 pour les réseaux qui ne
# laissent sortir que du HTTPS
ufw allow 3478/udp comment 'LiveKit TURN (spec 02)'
ufw allow 443/tcp comment 'HTTPS + TURN-TLS (specs 01/02)'
