#!/bin/sh
# REQ-INF-09 — **on entre sans e-mail, et sans mot de passe.**
#
# La question tranchée ici : les codes de secours de Keycloak, normalement un second
# facteur, peuvent-ils remplacer le mot de passe à la connexion ? Réponse mesurée contre
# une instance réelle : **oui**, dès lors que le flux sépare l'identifiant du facteur et
# pose les trois facteurs en ALTERNATIVE.
#
#   cd infra
#   docker compose up -d postgres keycloak
#   sh smoke/connexion-sans-email.sh
#
# Crée un utilisateur jetable, l'enrôle, se connecte avec un code, vérifie que le code est
# à usage unique, puis le supprime.
#
# Trois pièges rencontrés en l'écrivant, et pour lesquels ce fichier existe :
#   - Keycloak rend des URL absolues sur KC_HOSTNAME, que le réseau du compose ne résout
#     pas. Chaque saut réécrit l'hôte ; `curl -L` seul échoue en erreur TLS (rc=60), donc
#     sans rien dire d'utile.
#   - Keycloak réclame **un code précis** (« Code de secours #N »), pas n'importe lequel.
#   - Ce numéro se lit dans le libellé, et la recherche doit être ancrée sur
#     `for="recoveryCodeInput"` : la feuille PatternFly est inlinée dans la page, et ses
#     couleurs hexadécimales (#393939) répondent au motif « #chiffres » bien avant lui.
set -e
SN=$(grep '^SERVER_NAME=' .env | cut -d= -f2)

kc() { docker compose exec -T keycloak sh -c "
  K=/opt/keycloak/bin/kcadm.sh
  \$K config credentials --server http://localhost:8080/auth --realm master \
    --user \"\$KC_BOOTSTRAP_ADMIN_USERNAME\" --password \"\$KC_BOOTSTRAP_ADMIN_PASSWORD\" >/dev/null 2>&1
  ID=\$(\$K get users -r tacita -q username=essai-secours --fields id 2>/dev/null | grep -oE '[0-9a-f-]{36}')
  $1"; }

kc 'if [ -z "$ID" ]; then ID=$($K create users -r tacita -s username=essai-secours -s enabled=true -i); $K set-password -r tacita --username essai-secours --new-password "motdepasse-essai-1"; fi
    $K update users/$ID -r tacita -s "requiredActions=[\"CONFIGURE_RECOVERY_AUTHN_CODES\"]"' >/dev/null 2>&1
echo "utilisateur jetable prêt"

docker compose run --rm --no-deps -T -e SN="$SN" --entrypoint sh synapse -s <<'SCRIPT'
B=http://keycloak:8080
AUTH="$B/auth/realms/tacita/protocol/openid-connect/auth?client_id=synapse&response_type=code&scope=openid&redirect_uri=https%3A%2F%2F$SN%2F_synapse%2Fclient%2Foidc%2Fcallback"
gab() { grep -oE 'template: [a-z-]+\.ftl' "$1" 2>/dev/null | head -1; }
act() { grep -oE 'action="[^"]*"' "$1" | head -1 | sed -e 's/action="//' -e 's/"$//' -e 's/&amp;/\&/g' -e "s|https://$SN|$B|"; }
numero() { tr '>' '>\n' < "$1" | grep -A4 'for="recoveryCodeInput"' | grep -oE '#[0-9]+' | head -1 | tr -d '#'; }
FINI=non
suivre() { n=0; while [ "$n" -lt 5 ]; do
  L=$(grep -i '^location:' /tmp/h | tail -1 | sed -e 's/^[Ll]ocation: *//' -e 's/\r//'); [ -z "$L" ] && break
  case "$L" in *_synapse/client/oidc/callback*) FINI=oui; return 0;; esac
  curl -s -c $J -b $J -D /tmp/h "$(echo "$L" | sed -e "s|https://$SN|$B|")" -o /tmp/out; n=$((n+1)); done; }
envoyer() { FINI=non; curl -s -c $J -b $J -D /tmp/h "$@" -o /tmp/out; suivre; }

J=/tmp/j1; rm -f $J
curl -s -c $J -b $J "$AUTH" -o /tmp/a.html
envoyer "$(act /tmp/a.html)" -d "username=essai-secours"; cp /tmp/out /tmp/b.html
envoyer "$(act /tmp/b.html)" -d "password=motdepasse-essai-1"; cp /tmp/out /tmp/c.html
[ "$(gab /tmp/c.html)" = "template: login-recovery-authn-code-config.ftl" ] || { echo "ECHEC enrolement"; exit 1; }
C=$(grep -oE 'name="generatedRecoveryAuthnCodes" value="[^"]*"' /tmp/c.html | sed -e 's/.*value="//' -e 's/"$//')
G=$(grep -oE 'name="generatedAt" value="[^"]*"' /tmp/c.html | sed -e 's/.*value="//' -e 's/"$//')
LB=$(grep -oE 'name="userLabel" value="[^"]*"' /tmp/c.html | sed -e 's/.*value="//' -e 's/"$//')
envoyer "$(act /tmp/c.html)" --data-urlencode "generatedRecoveryAuthnCodes=$C" --data-urlencode "generatedAt=$G" --data-urlencode "userLabel=$LB" -d "kcRecoveryCodesConfirmationCheck=on"
echo "ok    enrolement : $(echo "$C" | tr ',' ' ' | wc -w) codes generes"

J=/tmp/j2; rm -f $J
curl -s -c $J -b $J "$AUTH" -o /tmp/d.html
[ "$(gab /tmp/d.html)" = "template: login-username.ftl" ] || { echo "ECHEC l identifiant n est pas seul a la premiere etape"; exit 1; }
echo "ok    premiere etape : identifiant seul"
envoyer "$(act /tmp/d.html)" -d "username=essai-secours"; cp /tmp/out /tmp/e.html
envoyer "$(act /tmp/e.html)" -d "tryAnotherWay=on"; cp /tmp/out /tmp/f.html
EX=$(grep -oE 'name="authenticationExecution" value="[^"]*"' /tmp/f.html | tail -1 | sed -e 's/.*value="//' -e 's/"$//')
envoyer "$(act /tmp/f.html)" -d "authenticationExecution=$EX"; cp /tmp/out /tmp/g.html
N=$(numero /tmp/g.html); [ -n "$N" ] || { echo "ECHEC numero de code introuvable"; exit 1; }
CODE=$(echo "$C" | cut -d, -f"$N")
envoyer "$(act /tmp/g.html)" -d "recoveryCodeInput=$CODE"
[ "$FINI" = "oui" ] && echo "ok    connexion avec le code #$N, sans mot de passe" || { echo "ECHEC connexion par code"; exit 1; }

J=/tmp/j3; rm -f $J
curl -s -c $J -b $J "$AUTH" -o /tmp/p.html
envoyer "$(act /tmp/p.html)" -d "username=essai-secours"; cp /tmp/out /tmp/q.html
envoyer "$(act /tmp/q.html)" -d "tryAnotherWay=on"; cp /tmp/out /tmp/r.html
EX=$(grep -oE 'name="authenticationExecution" value="[^"]*"' /tmp/r.html | tail -1 | sed -e 's/.*value="//' -e 's/"$//')
envoyer "$(act /tmp/r.html)" -d "authenticationExecution=$EX"; cp /tmp/out /tmp/s.html
N2=$(numero /tmp/s.html)
[ "$N2" != "$N" ] && echo "ok    code #$N consomme, Keycloak demande le #$N2" || echo "ECHEC le code n a pas ete consomme"
envoyer "$(act /tmp/s.html)" -d "recoveryCodeInput=$CODE"
[ "$FINI" = "non" ] && echo "ok    rejeu du code deja utilise refuse" || { echo "ECHEC rejeu accepte"; exit 1; }
SCRIPT

kc '[ -n "$ID" ] && $K delete users/$ID -r tacita' >/dev/null 2>&1 || true
echo "utilisateur jetable supprimé"
