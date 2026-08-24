#!/usr/bin/env python3
"""
REQ-INF-09 — **les gabarits SSO se compilent et se rendent.**

Ce que `infra/tests/synapse-templates.test.ts` ne peut pas prouver, et ne prétend pas
prouver : que ces fichiers sont du Jinja valide et qu'ils produisent une page. Vitest lit
leur source ; il ne les exécute pas — c'est Python, chez Synapse, avec ses filtres et son
échappement à lui. C'est la même jurisprudence que `infra/tests/invite-tokens.test.ts` :
un module peut avoir toutes ses assertions vertes et ne pas démarrer sous son vrai moteur.

Hors de `npm test`, comme le reste de `smoke/` : demande l'image Synapse épinglée.

    cd infra
    docker compose run --rm --no-deps -T --entrypoint python3 synapse - < smoke/rendu-gabarits.py

Ce qu'elle a déjà attrapé, et pourquoi elle reste : deux faux positifs de balayage — la
prose qui explique ce qu'on a retiré cite forcément ce qu'on a retiré, et l'URL de reprise
est absolue par nature. Les deux se sont présentés comme des pannes.
"""
import jinja2, re, sys

env = jinja2.Environment(
    loader=jinja2.FileSystemLoader("/conf/templates"),
    autoescape=jinja2.select_autoescape(["html"]),
)

profil = {"display_name": "Alice", "avatar_url": None}
cas = [
    ("sso_redirect_confirm.html", dict(display_url="chat.spleen.blog",
        redirect_url="https://chat.spleen.blog/?loginToken=syt_ABC",
        server_name="chat.spleen.blog", new_user=False,
        user_id="@alice:chat.spleen.blog", user_profile=profil)),
    ("sso_redirect_confirm.html", dict(display_url="chat.spleen.blog",
        redirect_url="https://chat.spleen.blog/?loginToken=syt_ABC",
        server_name="chat.spleen.blog", new_user=True,
        user_id="@bob:chat.spleen.blog", user_profile={"display_name": None})),
    ("sso_auth_confirm.html", dict(redirect_url="https://chat.spleen.blog/_synapse/x",
        description="add a device signing key", idp={"idp_name": "Compte"})),
    ("sso_auth_success.html", {}),
    ("sso_error.html", dict(error="unauthorised", error_description="")),
    ("sso_error.html", dict(error="provider_unavailable", error_description="")),
    ("sso_error.html", dict(error="invalid_grant", error_description="Code expiré <script>")),
    ("sso_error.html", dict(error="", error_description="")),
    ("sso_account_deactivated.html", {}),
    ("sso_auth_bad_user.html", dict(server_name="chat.spleen.blog",
        user_id_to_verify="@alice:chat.spleen.blog")),
]

echec = False
for nom, ctx in cas:
    etiquette = f"{nom} [{ctx.get('error', ctx.get('new_user', ''))}]"
    try:
        html = env.get_template(nom).render(**ctx)
    except Exception as e:
        print(f"ECHEC  {etiquette}: {type(e).__name__}: {e}"); echec = True; continue

    # `redirect_url` est absolue par nature et pointe vers notre propre hote : elle est
    # retiree avant le balayage, qui ne cherche que les hotes ecrits en dur.
    balaye = html.replace(ctx.get("redirect_url", "\0"), "")
    problemes = []
    if "<!DOCTYPE html>" not in html: problemes.append("pas de doctype")
    if 'lang="fr"' not in html: problemes.append("pas de lang=fr")
    if "--accent:" not in html: problemes.append("feuille non incluse")
    if "{{" in html or "{%" in html: problemes.append("Jinja non resolu")
    if re.search(r'(?:src|href)="https?://|url\(\s*[\'"]?https?://', balaye): problemes.append("hote distant")
    if "<script>" in html and nom != "sso_auth_success.html": problemes.append("script inattendu")
    if problemes:
        print(f"ECHEC  {etiquette}: {', '.join(problemes)}"); echec = True
    else:
        print(f"ok     {etiquette}  ({len(html)} octets)")

# Le contrat avec RecoveryStep, rendu et pas seulement present dans la source.
succes = env.get_template("sso_auth_success.html").render()
if 'postMessage("authDone", "*")' not in succes:
    print("ECHEC  signal authDone absent du rendu"); echec = True
else:
    print("ok     signal authDone present dans le rendu")

# L'echappement : error_description vient d'un tiers.
err = env.get_template("sso_error.html").render(error="x", error_description="<script>alert(1)</script>")
if "<script>alert" in err:
    print("ECHEC  error_description non echappe"); echec = True
else:
    print("ok     error_description echappe")

sys.exit(1 if echec else 0)
