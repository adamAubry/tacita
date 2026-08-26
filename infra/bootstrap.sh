#!/bin/sh
# Amorçage d'une Ubuntu nue : installer ce sans quoi rien du reste ne peut tourner.
#
# Pourquoi du shell POSIX et pas du TypeScript comme le reste de l'outil d'administration :
# c'est le problème de l'œuf et de la poule. `pnpm admin` a besoin de Node 22 et de pnpm,
# et Ubuntu 24.04 livre Node 18 dans apt. Ce script est donc le seul artefact qui doive
# tourner AVANT que quoi que ce soit d'autre existe — d'où l'absence totale de
# dépendances, `sh` et non `bash`, et rien qui suppose un shell interactif.
#
#   sh infra/bootstrap.sh          # annonce, demande une fois, puis travaille en silence
#   sh infra/bootstrap.sh --oui    # sans demander, pour l'automatisation
#
# Il est **rejouable** : ce qui est déjà installé n'est pas réinstallé. Il n'installe que
# des prérequis, ne touche à aucune configuration du projet, et ne démarre rien.
#
# Trois principes gouvernent son déroulé :
#
#  1. **Tout se demande avant.** La confirmation et le mot de passe sudo sont réclamés
#     d'emblée, jamais au milieu du travail : une invite qui surgit entre deux étapes
#     casse le compte rendu et laisse l'utilisateur devant un écran qui n'avance plus.
#  2. **Une ligne par étape, pas mille.** La sortie des installations part dans un
#     journal ; l'écran ne porte que « [3/6] Node 22 … ok ». En cas d'échec, les
#     dernières lignes du journal sont affichées — c'est là, et seulement là, qu'on a
#     besoin du détail.
#  3. **Constater d'abord, agir ensuite.** Rien n'est modifié avant que le plan entier
#     soit établi et accepté.

set -eu

NODE_MAJEUR_MINIMAL=22

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
JOURNAL="$(mktemp -t tacita-bootstrap-XXXXXX.log)"

SANS_DEMANDER=0
[ "${1:-}" = "--oui" ] && SANS_DEMANDER=1

dire() { printf '%s\n' "$*"; }
titre() { printf '\n%s\n' "$*"; }

# La version de pnpm est lue dans `package.json` plutôt que recopiée : deux endroits qui
# doivent s'accorder finissent toujours par diverger, et personne ne le verrait avant
# qu'un serveur neuf installe la mauvaise.
PNPM_VOULU="$(sed -n 's/.*"packageManager": *"\(pnpm@[^"]*\)".*/\1/p' "$RACINE/package.json")"
[ -n "$PNPM_VOULU" ] || PNPM_VOULU="pnpm@latest"

# On n'élève les privilèges que si on ne les a pas déjà : sur une image sans sudo — c'est
# fréquent en conteneur — le supposer ferait échouer un script qui n'en avait pas besoin.
EST_ROOT=0
[ "$(id -u)" -eq 0 ] && EST_ROOT=1
if [ "$EST_ROOT" -eq 0 ] && ! command -v sudo >/dev/null 2>&1; then
  dire "Ni root, ni sudo : relancer ce script en root."
  exit 1
fi

# Exécute une commande avec les droits root, en préservant l'environnement (les variables
# de proxy, notamment, sans lesquelles rien ne se télécharge derrière un pare-feu
# d'entreprise).
#
# Une fonction et non un préfixe `$SUDO` : `-E` est une option de **sudo**, pas de la
# commande appelée. Écrit `$SUDO -E bash -`, il devenait `-E bash -` quand la variable
# était vide — donc à chaque exécution en root, celle de tout serveur neuf. Le shell
# cherchait alors un programme nommé « -E ». Un préfixe qui change de sens selon qu'il
# est vide ou non n'est pas un préfixe.
en_root() {
  if [ "$EST_ROOT" -eq 1 ]; then
    "$@"
  else
    sudo -E "$@"
  fi
}

node_majeur() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node --version | sed 's/^v//; s/\..*//'
}

# --- 1. Constater, sans rien modifier -----------------------------------------------

# Une étape par ligne, « identifiant|libellé ». Pas de tableaux en shell POSIX ; une
# liste à séparateur en tient lieu et se parcourt sans surprise.
ETAPES=""
ajouter() { ETAPES="${ETAPES}$1|$2
"; }

BESOIN_APT=0

command -v curl >/dev/null 2>&1 || { ajouter curl "curl et les certificats racine"; BESOIN_APT=1; }
command -v git >/dev/null 2>&1 || { ajouter git "git"; BESOIN_APT=1; }

if ! command -v docker >/dev/null 2>&1; then
  ajouter docker "Docker"
elif ! docker compose version >/dev/null 2>&1; then
  # Docker posé par le script officiel apporte déjà le plugin ; ce cas ne concerne
  # qu'un Docker installé autrement, typiquement le paquet `docker.io` d'Ubuntu.
  ajouter compose "Plugin compose v2"
  BESOIN_APT=1
fi

if [ "$(node_majeur)" -lt "$NODE_MAJEUR_MINIMAL" ] 2>/dev/null; then
  ajouter node "Node ${NODE_MAJEUR_MINIMAL}"
  BESOIN_APT=1
fi

# pnpm vient de corepack, livré avec Node : rien à télécharger d'un autre dépôt, et la
# version est celle que le dépôt déclare. Sans lui, `pnpm admin` n'existe pas — et c'est
# tout l'outil d'administration qui manque à l'appel.
command -v pnpm >/dev/null 2>&1 || ajouter pnpm "pnpm (${PNPM_VOULU#pnpm@})"

# certbot ne sert qu'à `pnpm admin certificat`, mais l'installer maintenant évite un
# aller-retour au moment précis où l'on veut émettre.
command -v certbot >/dev/null 2>&1 || { ajouter certbot "certbot"; BESOIN_APT=1; }

if [ "$EST_ROOT" -eq 0 ] && ! id -nG "$(id -un)" | grep -qw docker; then
  ajouter groupe "Ajouter $(id -un) au groupe docker"
fi

NOMBRE="$(printf '%s' "$ETAPES" | grep -c . || true)"

if [ "$NOMBRE" -eq 0 ]; then
  titre "Rien à faire — tout est déjà en place."
  dire "  Docker  $(docker --version)"
  dire "  Compose $(docker compose version)"
  dire "  Node    $(node --version)"
  dire "  pnpm    $(pnpm --version)"
  titre "La suite :"
  dire "  pnpm admin init --domaine=chat.ton-domaine.fr --email=toi@ton-domaine.fr"
  dire "  pnpm admin doctor"
  rm -f "$JOURNAL"
  exit 0
fi

# `apt-get` n'est requis que pour ce que le script officiel de Docker ne pose pas. Le
# vérifier maintenant évite un demi-échec : Docker installé, puis un `apt-get` introuvable.
if [ "$BESOIN_APT" -eq 1 ] && ! command -v apt-get >/dev/null 2>&1; then
  dire "apt-get est introuvable : cette distribution n'est pas Debian ni Ubuntu."
  dire "Installer à la main Node ${NODE_MAJEUR_MINIMAL}+, pnpm, le plugin docker compose v2"
  dire "et certbot, puis relancer ce script — il constatera qu'il n'a plus rien à faire."
  rm -f "$JOURNAL"
  exit 1
fi

# --- 2. Tout demander maintenant, rien plus tard ------------------------------------

titre "Ce script va installer, en tant que root :"
while IFS='|' read -r _id libelle; do
  [ -n "$libelle" ] && dire "  • $libelle"
done <<FIN
$ETAPES
FIN
dire ""
dire "Il ne touche à aucune configuration du projet et ne démarre rien."
dire "Journal détaillé : $JOURNAL"

if [ "$SANS_DEMANDER" -eq 0 ]; then
  if [ ! -t 0 ]; then
    dire ""
    dire "Hors terminal : relancer avec --oui pour accepter sans qu'on demande."
    rm -f "$JOURNAL"
    exit 1
  fi
  printf '\nContinuer ? [o/N] '
  read -r reponse
  case "$reponse" in
    o | O | oui | Oui | y | Y | yes) ;;
    *)
      dire "Abandon — rien n'a été modifié."
      rm -f "$JOURNAL"
      exit 1
      ;;
  esac
fi

# Le mot de passe se demande ici, pas au milieu du compte rendu. Une invite sudo qui
# surgit entre deux étapes casse l'affichage et laisse devant un écran qui n'avance plus,
# sans dire qu'il attend quelque chose.
if [ "$EST_ROOT" -eq 0 ] && ! sudo -n -v >/dev/null 2>&1; then
  if [ ! -t 0 ]; then
    dire "sudo réclame un mot de passe et il n'y a pas de terminal pour le saisir."
    dire "Relancer en root, ou autoriser sudo sans mot de passe pour cet utilisateur."
    rm -f "$JOURNAL"
    exit 1
  fi
  dire ""
  sudo -v
fi

# --- 3. Exécuter, une ligne par étape ------------------------------------------------

faire() {
  case "$1" in
    curl) en_root apt-get install -y curl ca-certificates ;;
    git) en_root apt-get install -y git ;;
    docker) curl -fsSL https://get.docker.com | en_root sh ;;
    compose) en_root apt-get install -y docker-compose-plugin ;;
    node)
      # `apt install nodejs` sur Ubuntu 24.04 pose Node 18, qui n'a pas le retrait de
      # types dont dépendent les services de ce dépôt. NodeSource est le chemin documenté.
      #
      # Le `&&` n'est pas décoratif : `set -e` ne s'applique pas dans une fonction
      # appelée en condition d'un `if`. Enchaînées par un simple retour à la ligne, ces
      # deux commandes s'exécutaient toutes les deux — donc si NodeSource échouait,
      # `apt-get` posait quand même le Node 18 d'Ubuntu, et l'étape se disait en échec
      # après avoir installé la mauvaise version.
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJEUR_MINIMAL}.x" | en_root bash - &&
        en_root apt-get install -y nodejs
      ;;
    pnpm)
      en_root corepack enable && en_root corepack prepare "$PNPM_VOULU" --activate
      ;;
    certbot) en_root apt-get install -y certbot ;;
    groupe) en_root usermod -aG docker "$(id -un)" ;;
    *)
      dire "étape inconnue : $1"
      return 1
      ;;
  esac
}

titre "Installation"

if [ "$BESOIN_APT" -eq 1 ]; then
  printf '  [0/%s] %-34s' "$NOMBRE" "Index des paquets"
  if en_root apt-get update >>"$JOURNAL" 2>&1; then dire " ok"; else
    dire " ÉCHEC"
    titre "Dernières lignes du journal ($JOURNAL) :"
    tail -20 "$JOURNAL"
    exit 1
  fi
fi

# Redirection et non tube : derrière un tube, la boucle tournerait dans un sous-shell,
# le compteur y resterait et `exit` n'y sortirait que du sous-shell — le script
# poursuivrait allègrement après une étape en échec.
RANG=0
while IFS='|' read -r id libelle; do
  [ -n "$id" ] || continue
  RANG=$((RANG + 1))
  printf '  [%s/%s] %-34s' "$RANG" "$NOMBRE" "$libelle"
  if faire "$id" >>"$JOURNAL" 2>&1; then
    dire " ok"
  else
    dire " ÉCHEC"
    titre "Dernières lignes du journal ($JOURNAL) :"
    tail -20 "$JOURNAL"
    dire ""
    dire "Le journal complet est conservé. Relancer le script reprendra où il en est."
    exit 1
  fi
done <<FIN
$ETAPES
FIN

if printf '%s' "$ETAPES" | grep -q '^groupe|'; then
  titre "⚠ Se déconnecter puis se reconnecter"
  dire "  Le groupe docker ne prend effet qu'à la session suivante. Sans ça, la prochaine"
  dire "  commande Docker répondra « permission denied », et ce n'est pas une autre panne."
fi

titre "Prêt. La suite :"
dire "  pnpm admin init --domaine=chat.ton-domaine.fr --email=toi@ton-domaine.fr"
dire "  pnpm admin dns"
dire "  pnpm admin certificat"
dire "  pnpm admin doctor"
dire ""
dire "Journal de cette exécution : $JOURNAL"
