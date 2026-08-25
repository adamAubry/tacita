"""D-12 — le changement de mot de passe, gardé par la clé de récupération.

**Pourquoi ce module existe, et pourquoi ce n'est pas un stage UIA.** Vérifié dans l'image
déployée (Synapse v1.155.0, ``synapse/config/auth.py``) :

    password_enabled_for_login  = passwords_enabled and not passwords_for_reauth_only
    password_enabled_for_reauth = passwords_for_reauth_only or passwords_enabled

Les deux dérivent du même ``password_config.enabled``. Il n'existe donc **aucune**
configuration « connexion oui, ré-authentification non ». Or les types UIA sont des
alternatives : un stage maison serait offert *à côté* de ``m.login.password``, qui resterait
acceptable, et le garde serait décoratif. Un module ne contourne rien —
``AuthHandler.get_supported_login_types`` filtre ``m.login.password`` par le même drapeau.

D'où cette forme : ``POST /_matrix/client/v3/account/password`` est **bloqué au proxy**
(``infra/proxy/nginx.conf``), et ce module est le seul chemin restant. Les deux vont
ensemble — retirer la règle nginx rouvre le contournement sans que rien ne le dise. C'est
une jonction au sens de la règle 7, et ``infra/tests/mot-de-passe.test.ts`` la relit.

**Ce que ça coûte, et qui est écrit dans D-12** : la clé de récupération transite en clair
jusqu'ici. Elle n'ouvre pas un message, elle ouvre le magasin — un serveur qui la capte
déchiffre tout l'historique du compte. Non stocké n'est pas non vu. Ce module ne la
journalise nulle part et ne la garde pas au-delà de la requête ; c'est tout ce qu'il peut
faire, et ce n'est pas une protection contre l'opérateur.
"""

from __future__ import annotations

import hmac
from base64 import b64decode, b64encode
from hashlib import sha256
from typing import Any

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from synapse.http.server import DirectServeJsonResource, respond_with_json
from synapse.http.servlet import parse_json_object_from_request
from synapse.http.site import SynapseRequest
from synapse.module_api import ModuleApi

# Le type d'account data qui décrit la clé de secret storage par défaut, et celui qui dit
# laquelle est la clé par défaut. Tous deux dans la spec Matrix (« Secret storage »).
DEFAUT = "m.secret_storage.default_key"
DESCRIPTION = "m.secret_storage.key."

# `m.secret_storage.v1.aes-hmac-sha2`, seul algorithme que la spec définisse — et celui que
# `createRecoveryKeyFromPassphrase` produit. Un autre serait un compte qu'on ne sait pas
# vérifier : on refuse plutôt que de laisser passer.
ALGORITHME = "m.secret_storage.v1.aes-hmac-sha2"

# 8 caractères minimum : c'est la politique la plus basse qu'on puisse tenir sans mentir.
# Elle est ici et pas seulement dans l'UI — un garde côté écran n'en est pas un.
LONGUEUR_MINIMALE = 8


def _verifier_cle(cle: bytes, iv_b64: str, mac_b64: str) -> bool:
    """La vérification de clé de la spec Matrix, § « Secret storage », key check.

    HKDF-SHA256 sur la clé, sel de 32 zéros, ``info`` vide — puis AES-CTR sur 32 octets nuls
    avec l'``iv`` du descripteur, et HMAC-SHA256 du chiffré. Le résultat doit être le ``mac``
    que porte l'account data.

    C'est exactement ce que ``secretStorage.checkKey`` fait côté client (le shard le fait
    aussi, pour rendre la faute de frappe immédiate) — mais c'est **ici** que ça compte :
    un contrôle client se contourne en n'utilisant pas notre client.
    """
    derive = HKDF(algorithm=SHA256(), length=64, salt=bytes(32), info=b"").derive(cle)
    aes_key, hmac_key = derive[:32], derive[32:]

    iv = b64decode(iv_b64)
    if len(iv) != 16:
        return False

    chiffre = Cipher(algorithms.AES(aes_key), modes.CTR(iv)).encryptor()
    sortie = chiffre.update(bytes(32)) + chiffre.finalize()
    attendu = hmac.new(hmac_key, sortie, sha256).digest()

    # Comparaison à temps constant, et sur les octets décodés : deux base64 différents
    # peuvent coder les mêmes octets (padding), et une comparaison de chaînes fuirait par
    # le temps ce que le MAC existe pour protéger.
    try:
        return hmac.compare_digest(attendu, b64decode(mac_b64))
    except Exception:
        return False


class _Ressource(DirectServeJsonResource):
    def __init__(self, api: ModuleApi) -> None:
        super().__init__()
        self._api = api

    async def _async_render_POST(self, request: SynapseRequest) -> None:
        # L'appelant est identifié par son jeton d'accès, comme tout endpoint client. Ça ne
        # suffit pas à autoriser le changement — c'est précisément le point de D-12 : une
        # session volée ne doit pas pouvoir changer le mot de passe.
        requester = await self._api.get_user_by_req(request)
        user_id = requester.user.to_string()

        corps = parse_json_object_from_request(request)
        cle_b64 = corps.get("recovery_key")
        nouveau = corps.get("new_password")

        if not isinstance(cle_b64, str) or not isinstance(nouveau, str):
            respond_with_json(request, 400, {"errcode": "M_MISSING_PARAM"}, send_cors=True)
            return

        if len(nouveau) < LONGUEUR_MINIMALE:
            respond_with_json(
                request,
                400,
                {"errcode": "M_WEAK_PASSWORD", "error": "mot de passe trop court"},
                send_cors=True,
            )
            return

        descripteur = await self._descripteur(user_id)
        if descripteur is None:
            # Aucune clé de récupération sur ce compte : il n'y a rien à opposer, et
            # laisser passer ferait du garde une option. On refuse, et le message dit quoi
            # faire — c'est la règle 2, classer par résolubilité.
            respond_with_json(
                request,
                403,
                {
                    "errcode": "M_FORBIDDEN",
                    "error": "ce compte n'a pas de clé de récupération",
                },
                send_cors=True,
            )
            return

        try:
            cle = b64decode(cle_b64, validate=True)
        except Exception:
            cle = b""

        if len(cle) != 32 or not _verifier_cle(cle, descripteur["iv"], descripteur["mac"]):
            respond_with_json(
                request,
                403,
                {"errcode": "M_FORBIDDEN", "error": "clé de récupération incorrecte"},
                send_cors=True,
            )
            return

        auth_handler = self._api._auth_handler
        empreinte = await auth_handler.hash(nouveau)
        # `logout_devices=False` : le changement de mot de passe n'est pas une réponse à une
        # compromission ici — il est gardé par la clé, que seul le titulaire a. Déconnecter
        # tous les appareils ferait perdre l'historique déchiffré de chacun (REQ-COR-10),
        # pour un gain nul. La déconnexion reste un geste explicite.
        await self._api._hs.get_set_password_handler().set_password(
            user_id, empreinte, False, requester
        )
        respond_with_json(request, 200, {}, send_cors=True)

    async def _descripteur(self, user_id: str) -> dict[str, Any] | None:
        """Le descripteur de la clé de secret storage par défaut du compte, ou ``None``."""
        manager = self._api.account_data_manager
        defaut = await manager.get_global(user_id, DEFAUT)
        if not defaut or not isinstance(defaut.get("key"), str):
            return None

        description = await manager.get_global(user_id, DESCRIPTION + defaut["key"])
        if not description or description.get("algorithm") != ALGORITHME:
            return None
        if not isinstance(description.get("iv"), str) or not isinstance(
            description.get("mac"), str
        ):
            # Un descripteur sans `iv`/`mac` existe : c'est le cas d'une clé dérivée d'une
            # passphrase et jamais vérifiée. Rien à opposer, donc on refuse.
            return None
        return dict(description)


def create_module(config: Any, api: ModuleApi) -> None:  # noqa: ARG001
    api.register_web_resource("/_synapse/client/tacita/password", _Ressource(api))


class TacitaPassword:
    """Point d'entrée que `modules:` charge (`module: tacita_password.TacitaPassword`)."""

    def __init__(self, config: Any, api: ModuleApi) -> None:
        create_module(config, api)

    @staticmethod
    def parse_config(config: Any) -> Any:
        return config
