#!/bin/sh
# REQ-INF-09 — **le thème Keycloak est réellement servi.**
#
# `infra/tests/keycloak-theme.test.ts` lit les fichiers ; il ne prouve pas que Keycloak
# les charge. Un thème peut être parfaitement écrit et rester ignoré — c'est ce qui s'est
# produit à la première vérification, et la cause n'était pas dans le thème (voir plus bas).
# Règle 4 : « module terminé » et « produit qui marche » sont deux portes distinctes.
#
#   cd infra
#   docker compose up -d postgres keycloak
#   sh smoke/theme-keycloak.sh
#
# **Le piège qu'il a trouvé, et pour lequel il existe.** `start --import-realm` n'importe
# un realm que s'il **n'existe pas déjà**. Sur une pile qui a déjà démarré une fois, toute
# modification de `keycloak/realm-export.json` — `loginTheme` compris — est ignorée en
# silence : pas d'erreur, pas de log, l'ancienne configuration reste. Un déploiement qui
# reprend un volume existant n'aura donc pas ce thème tant que le realm n'est pas
# réimporté ou mis à jour (`kcadm.sh update realms/tacita -s loginTheme=tacita …`).
set -e

SN=$(grep '^SERVER_NAME=' .env | cut -d= -f2)
RU=$(printf 'https://%s/_synapse/client/oidc/callback' "$SN" | sed 's|:|%3A|g; s|/|%2F|g')
AUTH="http://keycloak:8080/auth/realms/tacita/protocol/openid-connect/auth?client_id=synapse&response_type=code&scope=openid&redirect_uri=$RU"

# Le client HTTP est le conteneur Synapse : l'image Keycloak n'embarque pas curl, et
# `keycloak:8080` n'est joignable que depuis le réseau du compose.
docker compose run --rm --no-deps -T --entrypoint sh synapse -c "
set -e
curl -s '$AUTH' -o /tmp/l.html
echo \"page de connexion : \$(wc -c < /tmp/l.html) octets\"

echec=0
verifier() {
  if grep -q \"\$1\" /tmp/l.html; then echo \"ok    \$2\"; else echo \"ECHEC \$2\"; echec=1; fi
}
# Le point n'est pas échappé par accident : 'tacita.css' non échappé matche aussi
# 'tacita/css/styles.css', et le test passe alors sur la feuille du parent.
verifier '/css/tacita\.css'   'notre feuille est liée'
verifier '/css/styles\.css'   'la feuille du parent est conservée'
verifier 'lang=\"fr\"'         'la page est en français'
verifier 'Connecte-toi'       'le dictionnaire est appliqué'
verifier 'pf-v5-theme-dark'   'la bascule sombre est présente'

# La feuille doit être servie, et être la nôtre : liée ne veut pas dire trouvée.
H=\$(grep -oE 'href=\"[^\"]*/css/tacita\.css\"' /tmp/l.html | head -1 | sed 's/href=\"//;s/\"//')
curl -sf \"http://keycloak:8080\$H\" -o /tmp/t.css
grep -q 'tacita-accent' /tmp/t.css && echo 'ok    la feuille servie porte nos jetons' || { echo 'ECHEC feuille etrangere'; echec=1; }
grep -q 'keycloak-logo-url: none' /tmp/t.css && echo 'ok    le logo Keycloak est éteint' || { echo 'ECHEC logo'; echec=1; }

exit \$echec
"
