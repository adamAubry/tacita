# Installer Tacita

Tacita s'installe depuis ton navigateur, pas depuis un magasin d'applications. Une fois
installée, elle a son icône, s'ouvre en plein écran et fonctionne hors ligne.

> [!NOTE]
> Tacita est **auto-hébergée** : il n'existe pas d'adresse publique unique. Celle que tu
> utilises est celle de ton cercle, par exemple `https://chat.example.org`. Demande-la à
> la personne qui héberge.

## Ce qu'il te faut

- L'**adresse** de ton instance.
- Un **compte**. L'inscription est fermée : la personne qui héberge te crée le compte ou
  t'envoie un lien d'invitation. C'est volontaire — un serveur ouvert ne resterait pas un
  cercle fermé.
- Un navigateur à jour.

## Installer

Ouvre l'adresse dans ton navigateur, puis :

| Système | Navigateur | Geste |
|---|---|---|
| iOS, iPadOS | Safari | Partager, puis **Sur l'écran d'accueil** — [guide Apple](https://support.apple.com/fr-fr/guide/iphone/iph42ab2f3a7/ios) |
| Android | Chrome | Menu, puis **Installer l'application** — [aide Chrome](https://support.google.com/chrome/answer/9658361) |
| Android | Firefox | Menu, puis **Ajouter à l'écran d'accueil** — [aide Mozilla](https://support.mozilla.org/fr/kb/ajouter-application-web-ecran-accueil-firefox-android) |
| Windows, macOS, Linux | Chrome | Icône d'installation dans la barre d'adresse — [aide Chrome](https://support.google.com/chrome/answer/9658361) |
| Windows, macOS, Linux | Edge | Icône d'installation dans la barre d'adresse — [doc Edge](https://learn.microsoft.com/fr-fr/microsoft-edge/progressive-web-apps/ux) |
| macOS | Safari 17+ | Fichier, puis **Ajouter au Dock** — [guide Apple](https://support.apple.com/fr-fr/guide/safari/ibrw1015/mac) |
| Windows, macOS, Linux | Firefox | Pas d'installation. Tacita marche dans l'onglet, sans icône ni notifications. |

Référence à jour, tous navigateurs confondus : [MDN, *Installing web apps*](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing) (en anglais).

> [!IMPORTANT]
> **Sur iPhone et iPad, les notifications n'arrivent que si Tacita est sur l'écran
> d'accueil.** En restant dans l'onglet Safari, tu ne recevras jamais rien. C'est une
> limite d'iOS, pas un réglage : [`apps/push-gateway/LIMITES.md`](apps/push-gateway/LIMITES.md).

## Se connecter

La connexion passe par la page d'identification de ton instance. Il n'y a pas de mot de
passe Tacita — l'identité vit chez le fournisseur d'identité du serveur, et tu peux y
activer une clé d'accès (empreinte, visage, clé physique).

Au premier lancement, Tacita te donne une **clé de récupération**. Garde-la hors de
l'appareil. Tes messages sont chiffrés sur ton appareil, et le serveur n'a pas les clés :
sans elle, un appareil perdu emporte l'historique.

## Si ça ne s'installe pas

| Symptôme | Cause probable |
|---|---|
| Aucune option d'installation | Le navigateur ne le permet pas — voir la ligne Firefox du tableau |
| Avertissement de sécurité à l'ouverture | Le serveur utilise un certificat auto-signé, réservé au développement. Signale-le à qui héberge : [`infra/README.md`](infra/README.md) |
| Installée, mais aucune notification sur iPhone | Elle a été ouverte depuis l'onglet et non depuis l'icône de l'écran d'accueil |

## Désinstaller

Comme n'importe quelle application : appui long sur l'icône, ou depuis la liste des
applications installées du navigateur. Rien ne subsiste côté serveur.
