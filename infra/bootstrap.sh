#!/bin/sh
# Amorçage d'une Ubuntu nue : installer ce sans quoi rien du reste ne peut tourner.
#
# Pourquoi du shell POSIX et pas du TypeScript comme le reste de l'outil d'administration :
# c'est le problème de l'œuf et de la poule. `pnpm admin` a besoin de Node 22, et Ubuntu
# 24.04 livre Node 18 dans apt. Ce script est donc le seul artefact qui doive tourner
# AVANT que quoi que ce soit d'autre existe — d'où l'absence totale de dépendances, `sh`
# et non `bash`, et rien qui suppose un shell interactif.
#
#   sh infra/bootstrap.sh          # annonce ce qu'il va faire, puis demande
#   sh infra/bootstrap.sh --oui    # sans demander, pour l'automatisation
#
# Il est **rejouable** : ce qui est déjà installé n'est pas réinstallé. Il n'installe que
# Docker et Node, ne touche à aucune configuration du projet, et ne démarre rien.

set -eu

NODE_MAJEUR_MINIMAL=22

SANS_DEMANDER=0
[ "${1:-}" = "--oui" ] && SANS_DEMANDER=1

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

node_majeur() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node --version | sed 's/^v//; s/\..*//'
}

# --- 1. Constater, sans rien modifier -----------------------------------------------

BESOIN_DOCKER=0
BESOIN_COMPOSE=0
BESOIN_NODE=0
BESOIN_GROUPE=0

command -v docker >/dev/null 2>&1 || BESOIN_DOCKER=1
docker compose version >/dev/null 2>&1 || BESOIN_COMPOSE=1
[ "$(node_majeur)" -ge "$NODE_MAJEUR_MINIMAL" ] 2>/dev/null || BESOIN_NODE=1
if [ -n "$SUDO" ] && ! id -nG "$(id -un)" | grep -qw docker; then BESOIN_GROUPE=1; fi

# Docker installé par le script officiel apporte déjà le plugin : ne pas le compter deux fois.
[ "$BESOIN_DOCKER" -eq 1 ] && BESOIN_COMPOSE=0

if [ "$((BESOIN_DOCKER + BESOIN_COMPOSE + BESOIN_NODE + BESOIN_GROUPE))" -eq 0 ]; then
  titre "Rien à faire — tout est déjà en place."
  dire "  Docker  $(docker --version)"
  dire "  Compose $(docker compose version)"
  dire "  Node    $(node --version)"
  titre "La suite :"
  dire "  pnpm admin init --domaine=chat.ton-domaine.fr --email=toi@ton-domaine.fr"
  dire "  pnpm admin doctor"
  exit 0
fi

# `apt-get` n'est requis que pour ce que le script officiel de Docker ne pose pas. Le
# vérifier maintenant évite un demi-échec : Docker installé, puis un `apt-get` introuvable.
if [ "$((BESOIN_COMPOSE + BESOIN_NODE))" -gt 0 ] && ! command -v apt-get >/dev/null 2>&1; then
  dire "apt-get est introuvable : cette distribution n'est pas Debian ni Ubuntu."
  dire "Installer à la main Node ${NODE_MAJEUR_MINIMAL}+ et le plugin docker compose v2,"
  dire "puis relancer ce script — il constatera qu'il n'a plus rien à faire."
  exit 1
fi

# --- 2. Annoncer, puis demander une seule fois --------------------------------------

titre "Ce script va, en tant que root :"
[ "$BESOIN_DOCKER" -eq 1 ] && dire "  • installer Docker    curl -fsSL https://get.docker.com | sh"
[ "$BESOIN_COMPOSE" -eq 1 ] && dire "  • installer le plugin compose v2   apt-get install docker-compose-plugin"
[ "$BESOIN_NODE" -eq 1 ] && dire "  • installer Node ${NODE_MAJEUR_MINIMAL}   depuis deb.nodesource.com (apt en livre 18)"
[ "$BESOIN_GROUPE" -eq 1 ] && dire "  • ajouter $(id -un) au groupe docker"
dire ""
dire "Il ne touche à aucune configuration du projet et ne démarre rien."

if [ "$SANS_DEMANDER" -eq 0 ]; then
  if [ ! -t 0 ]; then
    dire ""
    dire "Hors terminal : relancer avec --oui pour accepter sans qu'on demande."
    exit 1
  fi
  printf '\nContinuer ? [o/N] '
  read -r reponse
  case "$reponse" in
    o | O | oui | Oui | y | Y | yes) ;;
    *)
      dire "Abandon — rien n'a été modifié."
      exit 1
      ;;
  esac
fi

# --- 3. Exécuter ---------------------------------------------------------------------

if [ "$BESOIN_DOCKER" -eq 1 ]; then
  # Le script officiel, et non le paquet `docker.io` d'Ubuntu : ce dernier est ancien et
  # n'apporte pas le plugin compose v2, dont toute la pile dépend.
  titre "Docker"
  curl -fsSL https://get.docker.com | $SUDO sh
fi

if [ "$BESOIN_COMPOSE" -eq 1 ]; then
  titre "Plugin compose v2"
  $SUDO apt-get update && $SUDO apt-get install -y docker-compose-plugin
fi

if [ "$BESOIN_NODE" -eq 1 ]; then
  # `apt install nodejs` sur Ubuntu 24.04 pose Node 18, qui n'a pas le retrait de types
  # dont dépendent les services de ce dépôt. Le dépôt NodeSource est le chemin documenté.
  titre "Node ${NODE_MAJEUR_MINIMAL}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJEUR_MINIMAL}.x" | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi

if [ "$BESOIN_GROUPE" -eq 1 ]; then
  # Sans ce groupe, `docker info` répond « permission denied » et le diagnostic le signale.
  # Le changement ne prend effet qu'à la session suivante : le dire ici évite de chercher
  # pourquoi la commande échoue encore juste après l'avoir corrigée.
  titre "Droits Docker"
  $SUDO usermod -aG docker "$(id -un)"
  dire "  ⚠ se déconnecter puis se reconnecter pour que ce groupe prenne effet"
fi

titre "Prêt. La suite :"
dire "  pnpm admin init --domaine=chat.ton-domaine.fr --email=toi@ton-domaine.fr"
dire "  pnpm admin doctor"
