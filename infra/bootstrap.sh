#!/bin/sh
# Amorçage d'une Ubuntu nue : installer ce sans quoi rien du reste ne peut tourner.
#
# Pourquoi du shell POSIX et pas du TypeScript comme le reste de l'outil d'administration :
# c'est le problème de l'œuf et de la poule. `pnpm admin` a besoin de Node 22, et Ubuntu
# 24.04 livre Node 18 dans apt. Ce script est donc le seul artefact qui doive tourner
# AVANT que quoi que ce soit d'autre existe — d'où l'absence totale de dépendances, `sh`
# et non `bash`, et rien qui suppose un shell interactif.
#
#   sh infra/bootstrap.sh
#
# Il est **rejouable** : ce qui est déjà installé n'est pas réinstallé. Il n'installe que
# Docker et Node, ne touche à aucune configuration du projet, et ne démarre rien.

set -eu

NODE_MAJEUR_MINIMAL=22

dire() { printf '%s\n' "$*"; }
titre() { printf '\n%s\n' "$*"; }

# On préfixe par sudo seulement quand on n'est pas déjà root : sur une image qui n'a pas
# sudo installé — c'est fréquent en conteneur — le supposer ferait échouer un script qui
# n'en avait pas besoin.
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  if ! command -v sudo >/dev/null 2>&1; then
    dire "Ni root, ni sudo : relancer ce script en root."
    exit 1
  fi
  SUDO="sudo"
fi

titre "1. Docker"
if command -v docker >/dev/null 2>&1; then
  dire "  déjà installé — $(docker --version)"
else
  # Le script officiel, et non le paquet `docker.io` d'Ubuntu : ce dernier est ancien et
  # n'apporte pas le plugin compose v2, dont toute la pile dépend.
  dire "  installation via le script officiel (get.docker.com)"
  curl -fsSL https://get.docker.com | $SUDO sh
fi

if docker compose version >/dev/null 2>&1; then
  dire "  plugin compose — $(docker compose version)"
else
  dire "  installation du plugin compose v2"
  $SUDO apt-get update && $SUDO apt-get install -y docker-compose-plugin
fi

titre "2. Node ${NODE_MAJEUR_MINIMAL}"
node_majeur() {
  command -v node >/dev/null 2>&1 || return 1
  node --version | sed 's/^v//; s/\..*//'
}
majeure="$(node_majeur || echo 0)"
if [ "$majeure" -ge "$NODE_MAJEUR_MINIMAL" ] 2>/dev/null; then
  dire "  déjà installé — $(node --version)"
else
  # `apt install nodejs` sur Ubuntu 24.04 pose Node 18, qui n'a pas le retrait de types
  # dont dépendent les services de ce dépôt. Le dépôt NodeSource est le chemin documenté.
  dire "  Node ${majeure} est insuffisant : installation de ${NODE_MAJEUR_MINIMAL}.x depuis NodeSource"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJEUR_MINIMAL}.x" | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi

titre "3. Droits Docker"
# Sans ce groupe, `docker info` répond « permission denied » et le diagnostic le signale.
# Le changement de groupe ne prend effet qu'à la session suivante : le dire ici évite de
# chercher pourquoi la commande échoue encore juste après l'avoir corrigée.
if [ -n "$SUDO" ] && ! id -nG "$(id -un)" | grep -qw docker; then
  dire "  ajout de $(id -un) au groupe docker"
  $SUDO usermod -aG docker "$(id -un)"
  dire "  ⚠ se déconnecter puis se reconnecter pour que ce groupe prenne effet"
else
  dire "  rien à faire"
fi

titre "Prêt. La suite :"
dire "  pnpm admin init --domaine=chat.ton-domaine.fr --email=toi@ton-domaine.fr"
dire "  pnpm admin doctor"
