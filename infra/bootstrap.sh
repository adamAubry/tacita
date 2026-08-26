#!/bin/sh
# Assistant d'installation : d'une Ubuntu nue à une pile joignable.
#
# Un seul point d'entrée, six étapes, et rien à retenir entre elles. Le script est le
# parcours ; les commandes `pnpm admin` qu'il enchaîne restent utilisables séparément
# pour qui sait déjà ce qu'il fait.
#
#   sh infra/bootstrap.sh
#   sh infra/bootstrap.sh --domaine=chat.mon-domaine.fr --email=moi@mon-domaine.fr --oui
#   sh infra/bootstrap.sh --dev        # machine de développement, certificat auto-signé
#
# Pourquoi du shell POSIX alors que tout le reste est en TypeScript : c'est l'œuf et la
# poule. Ce script doit tourner AVANT Node — d'où `sh` et non `bash`, aucune dépendance,
# et rien qui suppose un shell interactif.
#
# Quatre principes, tirés de ce qui fait tenir un assistant (clig.dev, `gh auth login`,
# `flutter doctor`) :
#
#  1. Reprenable. Chaque étape détecte si elle est déjà faite et le dit. Relancer le
#     script après une interruption — ou après la reconnexion qu'exige le groupe docker —
#     repart exactement d'où l'on en était, sans rien refaire.
#  2. Tout se demande avant. Confirmation, domaine, e-mail et mot de passe sudo sont
#     réclamés d'emblée. Une question qui surgit au milieu du travail casse le compte
#     rendu et laisse devant un écran qui n'avance plus.
#  3. Détecter plutôt que demander. Rien n'est réclamé qui puisse être lu — le domaine
#     déjà posé dans `infra/.env` ne sera pas redemandé.
#  4. L'attente se gère. La propagation DNS ne renvoie pas à plus tard : elle boucle,
#     avec le choix de réessayer, de passer outre ou d'abandonner.

set -eu

NODE_MAJEUR_MINIMAL=22
TOTAL_ETAPES=6

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
JOURNAL="$(mktemp -t tacita-install-XXXXXX.log)"

SANS_DEMANDER=0
DEV=0
DOMAINE=""
COURRIEL=""
for argument in "$@"; do
  case "$argument" in
    --oui) SANS_DEMANDER=1 ;;
    --dev) DEV=1 ;;
    --domaine=*) DOMAINE="${argument#--domaine=}" ;;
    --email=*) COURRIEL="${argument#--email=}" ;;
    -h | --help)
      sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'option inconnue : %s\n' "$argument"
      exit 2
      ;;
  esac
done

dire() { printf '%s\n' "$*"; }
titre() { printf '\n%s\n' "$*"; }
deja() { printf '  ✓ %s\n' "$*"; }
souci() { printf '  ✗ %s\n' "$*"; }

etape() {
  printf '\n  Étape %s sur %s · %s\n' "$1" "$TOTAL_ETAPES" "$2"
  printf '  %s\n' "$(printf '%*s' 46 '' | tr ' ' '-')"
}

# Rend une commande silencieuse — sa sortie part au journal — tout en montrant qu'elle
# travaille. Sans ce battement, un build de dix minutes passe pour un écran figé, et
# c'est à ce moment-là qu'on l'interrompt.
avec_battement() {
  "$@" >>"$JOURNAL" 2>&1 &
  attendu=$!
  # Sonder finement, afficher lentement. Dormir trois secondes entre deux sondages
  # faisait payer trois secondes à toute étape, même instantanée ; ne battre qu'un
  # quart de seconde noierait un build de dix minutes sous les points.
  battement=0
  while kill -0 "$attendu" 2>/dev/null; do
    battement=$((battement + 1))
    [ "$((battement % 12))" -eq 1 ] && printf '.'
    sleep 0.25 2>/dev/null || sleep 1
  done
  wait "$attendu"
}

echouer() {
  dire " ÉCHEC"
  titre "  Dernières lignes du journal ($JOURNAL) :"
  tail -20 "$JOURNAL" | sed 's/^/    /'
  titre "  Le journal est conservé. Corriger, puis relancer :"
  dire "    sh infra/bootstrap.sh"
  dire "  Le script reprendra à cette étape."
  exit 1
}

# L'outil d'administration s'appelle par Node plutôt que par `pnpm admin` : un pnpm
# installé à l'instant même n'est pas toujours visible du shell en cours, et la
# transmission des options à travers `pnpm run` réserve des surprises.
admin() {
  (cd "$RACINE" && node --disable-warning=ExperimentalWarning --experimental-strip-types \
    apps/admin/src/index.ts "$@")
}

# ════════ Ce qu'on doit savoir avant de commencer ════════

EST_ROOT=0
[ "$(id -u)" -eq 0 ] && EST_ROOT=1
if [ "$EST_ROOT" -eq 0 ] && ! command -v sudo >/dev/null 2>&1; then
  dire "Ni root, ni sudo : relancer ce script en root."
  exit 1
fi

# `-E` est une option de sudo, pas de la commande appelée. Écrit `$SUDO -E bash -`, il
# devenait `-E bash -` quand la variable était vide — donc à chaque exécution en root,
# celle de tout serveur neuf. Un préfixe qui change de sens selon qu'il est vide ou non
# n'est pas un préfixe.
en_root() {
  if [ "$EST_ROOT" -eq 1 ]; then "$@"; else sudo -E "$@"; fi
}

PNPM_VOULU="$(sed -n 's/.*"packageManager": *"\(pnpm@[^"]*\)".*/\1/p' "$RACINE/package.json")"
[ -n "$PNPM_VOULU" ] || PNPM_VOULU="pnpm@latest"

node_majeur() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node --version | sed 's/^v//; s/\..*//'
}

# --- Ce qui manque, constaté sans rien modifier ---

ETAPES=""
ajouter() { ETAPES="${ETAPES}$1|$2
"; }
BESOIN_APT=0

command -v curl >/dev/null 2>&1 || { ajouter curl "curl et les certificats racine"; BESOIN_APT=1; }
command -v git >/dev/null 2>&1 || { ajouter git "git"; BESOIN_APT=1; }
if ! command -v docker >/dev/null 2>&1; then
  ajouter docker "Docker"
elif ! docker compose version >/dev/null 2>&1; then
  ajouter compose "Plugin compose v2"
  BESOIN_APT=1
fi
if [ "$(node_majeur)" -lt "$NODE_MAJEUR_MINIMAL" ] 2>/dev/null; then
  ajouter node "Node ${NODE_MAJEUR_MINIMAL}"
  BESOIN_APT=1
fi
command -v pnpm >/dev/null 2>&1 || ajouter pnpm "pnpm (${PNPM_VOULU#pnpm@})"
command -v certbot >/dev/null 2>&1 || { ajouter certbot "certbot"; BESOIN_APT=1; }
BESOIN_GROUPE=0
if [ "$EST_ROOT" -eq 0 ] && ! id -nG "$(id -un)" | grep -qw docker; then
  ajouter groupe "Ajouter $(id -un) au groupe docker"
  BESOIN_GROUPE=1
fi
NOMBRE_PREREQUIS="$(printf '%s' "$ETAPES" | grep -c . || true)"

if [ "$BESOIN_APT" -eq 1 ] && ! command -v apt-get >/dev/null 2>&1; then
  dire "apt-get est introuvable : cette distribution n'est pas Debian ni Ubuntu."
  dire "Installer à la main Node ${NODE_MAJEUR_MINIMAL}+, pnpm, le plugin docker compose v2"
  dire "et certbot, puis relancer — le script constatera qu'il n'a plus rien à faire."
  rm -f "$JOURNAL"
  exit 1
fi

# --- Ce qui est déjà fait, pour ne pas le redemander ---

ENV="$RACINE/infra/.env"
CONFIG_FAITE=0
if [ -f "$ENV" ] && ! grep -q 'change-me' "$ENV"; then CONFIG_FAITE=1; fi
DOMAINE_POSE=""
[ -f "$ENV" ] && DOMAINE_POSE="$(sed -n 's/^SERVER_NAME=\(.*\)$/\1/p' "$ENV")"
case "$DOMAINE_POSE" in *example.org | *example.com | "") DOMAINE_POSE="" ;; esac
[ -n "$DOMAINE_POSE" ] && [ -z "$DOMAINE" ] && DOMAINE="$DOMAINE_POSE"

CERT_FAIT=0
[ -f "$RACINE/infra/proxy/certs/fullchain.pem" ] && CERT_FAIT=1

# ════════ Annoncer, puis tout demander d'un coup ════════

titre "Installation de Tacita"
dire ""
dire "  Six étapes. Le script les enchaîne, et reprend où il en était si tu l'arrêtes."
dire "  Journal détaillé : $JOURNAL"
titre "  Ce qui sera fait :"
if [ "$NOMBRE_PREREQUIS" -eq 0 ]; then
  dire "    1. Prérequis         déjà en place"
else
  dire "    1. Prérequis         $NOMBRE_PREREQUIS à installer, en tant que root"
  while IFS='|' read -r _id libelle; do
    [ -n "$libelle" ] && dire "                          • $libelle"
  done <<FIN
$ETAPES
FIN
fi
if [ "$CONFIG_FAITE" -eq 1 ]; then
  dire "    2. Configuration     déjà faite"
else
  dire "    2. Configuration     secrets, clés VAPID, domaine"
fi
dire "    3. DNS               vérification des deux enregistrements"
if [ "$CERT_FAIT" -eq 1 ]; then
  dire "    4. Certificat        déjà en place"
else
  dire "    4. Certificat        émission TLS"
fi
dire "    5. Pile              démarrage des conteneurs"
dire "    6. Vérification      diagnostic complet"

if [ "$SANS_DEMANDER" -eq 0 ]; then
  if [ ! -t 0 ]; then
    titre "Hors terminal : relancer avec --oui, et --domaine= --email= si besoin."
    rm -f "$JOURNAL"
    exit 1
  fi
  printf '\n  Continuer ? [o/N] '
  read -r reponse
  case "$reponse" in
    o | O | oui | Oui | y | Y | yes) ;;
    *)
      dire "  Abandon — rien n'a été modifié."
      rm -f "$JOURNAL"
      exit 1
      ;;
  esac
fi

# Le domaine et l'e-mail ne servent qu'à la configuration — mais ils se demandent ici,
# avec le reste, plutôt qu'au milieu du parcours.
# L'invite part sur **stderr**, et c'est vital : la fonction est appelée dans un
# `$(...)`, qui capture stdout. Écrite sur stdout, la question n'apparaissait donc
# jamais — le script semblait tourner dans le vide alors qu'il attendait une saisie —
# et se retrouvait de surcroît collée devant la réponse dans la variable.
demander() {
  printf '  %s : ' "$1" >&2
  read -r saisie
  printf '%s' "$saisie"
}
if [ "$CONFIG_FAITE" -eq 0 ]; then
  if [ -z "$DOMAINE" ]; then
    if [ ! -t 0 ]; then
      dire "  Le domaine manque : le passer en --domaine=chat.mon-domaine.fr"
      rm -f "$JOURNAL"
      exit 2
    fi
    dire ""
    DOMAINE="$(demander 'Nom du serveur (ex. chat.mon-domaine.fr)')"
  fi
  if [ -z "$COURRIEL" ]; then
    if [ ! -t 0 ]; then
      dire "  L'e-mail manque : le passer en --email=moi@mon-domaine.fr"
      rm -f "$JOURNAL"
      exit 2
    fi
    COURRIEL="$(demander 'Adresse e-mail de contact')"
  fi
fi

# Le mot de passe sudo se demande ici, pas entre deux étapes.
if [ "$EST_ROOT" -eq 0 ] && [ "$NOMBRE_PREREQUIS" -gt 0 ] && ! sudo -n -v >/dev/null 2>&1; then
  if [ ! -t 0 ]; then
    dire "  sudo réclame un mot de passe et il n'y a pas de terminal pour le saisir."
    dire "  Relancer en root, ou autoriser sudo sans mot de passe pour cet utilisateur."
    rm -f "$JOURNAL"
    exit 1
  fi
  dire ""
  sudo -v
fi

# ════════ 1. Prérequis ════════

etape 1 "Prérequis"

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
      # appelée en condition d'un `if`. Sans lui, `apt-get` posait le Node 18 d'Ubuntu
      # même quand NodeSource avait échoué.
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJEUR_MINIMAL}.x" | en_root bash - &&
        en_root apt-get install -y nodejs
      ;;
    pnpm) en_root corepack enable && en_root corepack prepare "$PNPM_VOULU" --activate ;;
    certbot) en_root apt-get install -y certbot ;;
    groupe) en_root usermod -aG docker "$(id -un)" ;;
    *) return 1 ;;
  esac
}

if [ "$NOMBRE_PREREQUIS" -eq 0 ]; then
  deja "tout est déjà en place"
else
  if [ "$BESOIN_APT" -eq 1 ]; then
    printf '  [0/%s] %-30s' "$NOMBRE_PREREQUIS" "Index des paquets"
    avec_battement en_root apt-get update || echouer
    dire " ok"
  fi
  RANG=0
  while IFS='|' read -r id libelle; do
    [ -n "$id" ] || continue
    RANG=$((RANG + 1))
    printf '  [%s/%s] %-30s' "$RANG" "$NOMBRE_PREREQUIS" "$libelle"
    avec_battement faire "$id" || echouer
    dire " ok"
  done <<FIN
$ETAPES
FIN
  # Le shell garde en cache l'emplacement des commandes : sans ça, `node` fraîchement
  # installé resterait introuvable pour le reste du script.
  hash -r 2>/dev/null || true
fi

# Le groupe docker ne prend effet qu'à la session suivante. Poursuivre mènerait droit à
# un « permission denied » à l'étape 5, qu'on prendrait pour une autre panne.
if [ "$BESOIN_GROUPE" -eq 1 ]; then
  titre "  Il faut se reconnecter avant de continuer."
  dire "    Le groupe docker vient d'être ajouté et ne prend effet qu'à la prochaine"
  dire "    session. Sans ça, le démarrage de la pile répondrait « permission denied »,"
  dire "    et ce ne serait pas une autre panne."
  titre "    exit          # puis se reconnecter en SSH"
  dire "    cd $RACINE && sh infra/bootstrap.sh"
  dire ""
  dire "  Le script reprendra à l'étape 2."
  exit 0
fi

# ════════ 2. Configuration ════════

etape 2 "Configuration"

if [ "$CONFIG_FAITE" -eq 1 ]; then
  deja "infra/.env est déjà renseigné"
  deja "domaine : $DOMAINE"
else
  if [ "$DEV" -eq 1 ]; then
    admin init --domaine="$DOMAINE" --email="$COURRIEL" --sans-suite --dev | sed 's/^/  /'
  else
    admin init --domaine="$DOMAINE" --email="$COURRIEL" --sans-suite | sed 's/^/  /'
  fi
fi

# ════════ 3. DNS ════════

etape 3 "DNS"

if [ "$DEV" -eq 1 ]; then
  deja "développement : le fichier hosts tient lieu de DNS"
  dire "    Ajouter « 127.0.0.1 $DOMAINE call.$DOMAINE » s'il n'y est pas déjà."
else
  # L'attente se gère ici, elle ne se renvoie pas à plus tard. La propagation prend de
  # quelques minutes à quelques heures ; le script montre l'état et laisse le choix.
  while :; do
    if admin dns >/dev/null 2>&1; then
      deja "les deux noms résolvent vers cette machine"
      break
    fi
    admin dns 2>&1 | sed 's/^/  /' || true
    if [ "$SANS_DEMANDER" -eq 1 ] || [ ! -t 0 ]; then
      souci "le DNS n'est pas prêt, et personne ne peut répondre — arrêt ici"
      dire "    Créer les enregistrements, puis relancer : sh infra/bootstrap.sh"
      exit 1
    fi
    printf '  [r] réessayer   [p] passer outre   [a] abandonner : '
    read -r choix
    case "$choix" in
      r | R | "") continue ;;
      p | P)
        souci "on passe outre — l'émission du certificat échouera probablement"
        break
        ;;
      *)
        dire "  Abandon. Relancer plus tard : sh infra/bootstrap.sh"
        exit 1
        ;;
    esac
  done
fi

# ════════ 4. Certificat ════════

etape 4 "Certificat"

if [ "$CERT_FAIT" -eq 1 ]; then
  deja "un certificat est déjà en place"
  dire "    Renouvellement automatique ; --force pour réémettre malgré tout."
else
  # Le certificat reste au premier plan : certbot prend du temps, parle, et consomme un
  # quota. C'est exactement ce qu'on ne masque pas derrière un point qui clignote.
  CERT_ARGS=""
  [ "$SANS_DEMANDER" -eq 1 ] && CERT_ARGS="--oui"
  [ "$DEV" -eq 1 ] && CERT_ARGS="$CERT_ARGS --dev"
  # shellcheck disable=SC2086
  if admin certificat --email="$COURRIEL" $CERT_ARGS; then
    deja "certificat en place"
  else
    souci "l'émission n'a pas abouti"
    dire "    La pile peut démarrer sans, mais rien ne répondra en HTTPS."
    dire "    Reprendre ensuite : pnpm admin certificat"
  fi
fi

# ════════ 5. Pile ════════

etape 5 "Pile"

if [ "$DEV" -eq 1 ]; then
  COMPOSE="-f docker-compose.yml -f smoke/docker-compose.yml"
else
  COMPOSE="-f docker-compose.yml -f staging/docker-compose.yml"
fi

[ -n "$(docker compose -p tacita ps -q 2>/dev/null)" ] && deja "des conteneurs tournent déjà, ils seront mis à jour"
printf '  %-38s' "Construction et démarrage"
avec_battement sh -c "cd '$RACINE/infra' && docker compose $COMPOSE up -d --build" || echouer
dire " ok"

# ════════ 6. Vérification ════════

etape 6 "Vérification"

VERDICT=0
if [ "$DEV" -eq 1 ]; then
  admin doctor --dev || VERDICT=$?
else
  admin doctor || VERDICT=$?
fi

# Conclure « terminé » sur un diagnostic qui bloque serait le pire des deux mondes : le
# script se féliciterait juste sous les lignes ✗ qu'il vient d'afficher. La fin suit le
# verdict, et le code de sortie avec — un déploiement automatisé doit pouvoir s'y fier.
if [ "$VERDICT" -eq 0 ]; then
  titre "Terminé."
  if [ "$DEV" -eq 1 ]; then
    dire "  Ouvrir https://$DOMAINE, après avoir importé infra/proxy/certs/fullchain.pem"
    dire "  comme autorité de confiance du navigateur."
  else
    dire "  Ouvrir https://$DOMAINE et créer le premier compte depuis l'application :"
    dire "  identifiant et mot de passe, sans code d'invitation."
  fi
  dire ""
  dire "  Journal de cette installation : $JOURNAL"
else
  titre "Il reste des lignes ✗ ci-dessus."
  dire "  Chacune porte son remède. Les corriger, puis relancer :"
  dire ""
  dire "    sh infra/bootstrap.sh        # reprend le parcours là où il en est"
  dire "    pnpm admin doctor            # vérifie seulement, sans rien toucher"
  dire ""
  dire "  Journal de cette installation : $JOURNAL"
  exit 1
fi
