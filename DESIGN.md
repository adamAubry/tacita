# DESIGN.md

## Overview

**Stratégie d'identité : l'instrument de précision.** L'app ne cherche pas à avoir l'air « moderne » — c'est la voie la plus courte vers l'air daté. Elle vise la qualité perçue d'un bel outil : neutre, exact, silencieux. Quatre principes non négociables :

1. **Clair par défaut.** Fond neutre, texte encre. Le sombre existe (réglage, REQ-UI-03) mais n'est pas l'identité. La lumière est ce qui vieillit le mieux et ce qui paraît poli au plus grand nombre.
2. **Une seule couleur.** Un vert profond, rare et constant. Tout le reste est neutre. La retenue chromatique est ce qui distingue un produit fini d'un prototype.
3. **Géométrie stricte — c'est la signature.** Grille de 4 pt partout, rayons faibles et constants, filets fins (hairlines de 1 px) plutôt qu'ombres, alignements exacts, chiffres tabulaires pour toute heure et tout compteur. La précision EST le style.
4. **Zéro effet de mode.** Interdits définitifs : dégradés, glassmorphism/flou décoratif, blobs, néon, ombres portées molles, coins très arrondis, emoji décoratifs dans l'UI, animations démonstratives. Si un effet se remarque, il est de trop. *(Les deux exceptions de l'écran profil — le verre du retour ci-dessous, et l'ombre diffuse de l'avatar en § Elevation — ont la même cause unique : une photo fournie par l'utilisateur derrière un élément qui doit rester lisible. Elles ne s'appliquent qu'à cet écran ; s'il en apparaît une troisième ailleurs, c'est que la règle a cédé, pas qu'elle a une famille.)* **Une seule exception, nommée et bornée** (ratifiée le 10/08/2026, resserrée le même jour) : le **bouton de retour** de l'écran profil, posé sur la bannière de l'utilisateur. Le mot-clé est *décoratif* — ici le flou est structurel : sous ce bouton il y a une photo arbitraire, choisie par quelqu'un d'autre, où aucune paire de contraste n'est vérifiable à l'avance. Le verre est ce qui rend le retour lisible quelle que soit l'image ; un fond opaque le ferait aussi, mais en masquant la bannière. Le verre portait d'abord tout le bandeau flottant : une barre pleine largeur voilait la bannière sur la hauteur même qu'elle est censée laisser voir, et l'exception s'est réduite à ce qu'elle justifiait — **un seul bouton, celui dont on ne peut pas se passer pour sortir de l'écran**. L'exception ne s'étend à aucun autre élément ni aucun autre écran : partout ailleurs, le fond est un token et le contraste se vérifie.

Géométrie de référence : contrôles r6, cartes et modals r10, bottom-sheets r12 ; **avatars en carré arrondi** (`--tacita-radius-avatar`) — signature délibérée face aux cercles de toutes les messageries ; espacement uniquement en multiples de 4 ; séparation par hairline ou par espace, jamais par changement de fond gratuit.

**Ce fichier porte les barèmes du système, pas les réglages d'un composant.** Une échelle partagée — la grille de 4, les rayons de référence, la table de couleurs, les sept styles de texte, les quatre niveaux d'élévation — est une décision de système et se lit ici, chiffrée. La valeur propre à **un** composant nommé vit dans son token, et ce fichier dit alors ce que le token vaut *pour le dessin* : à quoi il sert, pourquoi il existe, ce qu'il interdit. Le nombre a une seule maison, et changer le dessin reste un changement de ce fichier — mais sous la forme d'une intention, jamais d'une valeur recopiée qui dériverait de son token au premier ajustement. Timeline Discord-style sans bulles, inchangée. Toute couleur passe par les tokens ci-dessous (mappés sur le thème Astryx au spike M-A) ; **aucune valeur hexadécimale dans le code des composants**. Cibles tactiles ≥ 36 px, safe-areas iOS en standalone. *(Plancher abaissé de 44 à 36 px le 10/08/2026. 44 px est le chiffre d'Apple — 44 pt — et le niveau **AAA** de WCAG ; le plancher **AA** est de 24 px, que 36 dépasse largement. À 44, chaque contrôle du shard sortait du barème d'Astryx, qui plafonne à 36 : on ne peut pas imposer un plancher que la bibliothèque de composants imposée ne sait pas atteindre — la contrainte ne produisait pas des cibles plus sûres, elle produisait des boutons difformes. Un composant qui a besoin de plus pose plus : la navbar garde ses 44 px, et ses tests les nomment.)*

## Colors

Neutres à très léger sous-ton vert (invisible consciemment, cohérent avec l'accent). Le clair est le thème de référence ; le sombre en dérive, neutre lui aussi — jamais bleuté, jamais noir pur.

| Token | Clair (défaut) | Sombre | Usage |
|---|---|---|---|
| `bg` | #F6F7F6 | #131514 | fond d'application |
| `surface` | #FFFFFF | #1B1E1D | cartes, listes, composer |
| `surface-raised` | #FFFFFF | #232726 | modals, dropdowns, bottom-sheets |
| `hairline` | #E2E5E3 | #303534 | filets, contours, séparateurs |
| `text` | #1A1D1C | #E9ECEA | texte principal (encre) |
| `text-muted` | #5E6663 | #9AA39F | aperçus, dates, user ids, méta |
| `accent` | #155E4D | #4FBD96 | actions primaires, état actif, liens, coches « délivré/lu » |
| `accent-pressed` | #0E463A | #3EA381 | état pressé de l'accent |
| `accent-soft` | #155E4D à 8 % | #4FBD96 à 16 % | fonds de mention, selector actif, badge @ |
| `read` | = `accent` | = `accent` | double coche « lu » — la coche verte est un trait d'identité |
| `success` | = `accent` | = `accent` | accepter, états positifs (pas de second vert) |
| `danger` | #B3352C | #E5716A | supprimer, refuser, quitter, bloquer |
| `warning` | #9A6A00 | #D9A441 | avertissements (limites connues) |
| `highlight` | #155E4D à 14 %, texte `text` | #4FBD96 à 22 %, texte `text` | occurrences de recherche, `@me` |
| `scrim` | #FFFFFF à 70 % | #131514 à 60 % | voile de lisibilité sur fond d'écran personnalisé |
| `viewer` | #131514 | #131514 | fond du visionneur plein écran — **le même dans les deux thèmes** |
| `on-viewer` | #E9ECEA | #E9ECEA | encre et commandes posées sur `viewer` (muet : #9AA39F) |
| `glass` | #F6F7F6 à 65 % | #131514 à 65 % | **bouton de retour du profil, et lui seul** — teinte **et** `blur(12px)`, indissociables |

`viewer` et `on-viewer` sont le couple du thème sombre **figé** : une photo se regarde sur un fond neutre sombre, que l'app soit en clair ou en sombre. Ils existent parce que le fond inversé d'Astryx suit le thème *et* vaut exactement `text` : les commandes du visionneur y étaient de la couleur de leur propre fond, donc invisibles — c'est le seul endroit de l'app où l'encre du thème ne s'applique pas.

`glass` est un couple, pas une couleur : la teinte seule laisse passer les hautes fréquences d'une photo derrière du texte. Un navigateur sans `backdrop-filter` garde les 65 % d'opacité — l'effet dégrade, la lisibilité non. Règles : l'accent occupe moins de 5 % de tout écran courant — s'il devient ambiant, c'est un bug de design ; `danger` jamais pour de l'emphase non destructive ; badges de non-lus en `text` sur `accent-soft` (pas de pastille rouge, cf. PRODUCT.md) ; contraste AA vérifié pour chaque paire ; aucune autre couleur n'existe.

## Typography

Pile système, aucune webfont : native, rapide, intemporelle — la personnalité vient de la composition, pas d'une fonte de caractère. `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`. Mono pour user ids et clé de récupération : `ui-monospace, "SF Mono", Consolas, monospace`.

**Deux graisses seulement : 400 et 600.** La hiérarchie se fait par taille, espace et couleur (`text` vs `text-muted`), pas par accumulation de graisses. **Chiffres tabulaires** (`font-variant-numeric: tabular-nums`) obligatoires pour heures, dates, compteurs et durées — rien ne bouge quand les chiffres changent.

| Style | Taille/interligne | Graisse | Usage |
|---|---|---|---|
| display-large | 28/32 | 600 | nom sur l'écran profil, et lui seul (ajouté le 10/08/2026) |
| display | 22/28 | 600 | nom dans Conversation starter |
| title | 17/24 | 600 | titres de layout (header) |
| body-strong | 15/20 | 600 | noms d'auteurs, titres de cartes |
| body | 15/20 | 400 | messages, contenu courant |
| secondary | 13/18 | 400 | aperçus, notes, méta |
| caption | 12/16 | 600 | heures, badges, séparateur de date, libellés d'Info buttons |

Pas d'italique pour l'information critique, pas de capitales de tracking, pas de texte en accent hors liens et actions.

## Elevation

La profondeur s'exprime d'abord par le **filet** (hairline), l'ombre est un murmure. Quatre niveaux, pas plus.

| Niveau | Usage | Clair | Sombre |
|---|---|---|---|
| e0 | fond, timeline | aucun | aucun |
| e1 | cartes, previews, composer | `surface` + hairline | `surface` + hairline |
| e2 | dropdowns, hold menu, modals, sheets | `surface-raised` + hairline + ombre 0 2 8 à 8 % | `surface-raised` + hairline |
| e3 | toasts, bannière d'appel en cours | `surface-raised` + hairline + ombre 0 4 12 à 10 % | `surface-raised` + hairline + ombre 0 4 12 à 40 % |

Jamais d'ombre sans hairline — **une exception, nommée et bornée** (10/08/2026) : `--tacita-ombre-avatar`, l'ombre de l'avatar de l'écran profil. Elle sort du barème des quatre niveaux ci-dessus — plus floue, et plus opaque en sombre qu'en clair, sur la jurisprudence de `e3` : une ombre noire sur un fond sombre ne se voit plus. Elle est diffuse, ce que la § Overview interdit — parce qu'elle ne dit pas une élévation : l'avatar n'est pas surélevé, il est *posé dans* la bannière. Elle sépare son bord d'une photo arbitraire, choisie par quelqu'un d'autre, où aucune paire de contraste n'est vérifiable à l'avance. C'est mot pour mot l'argument du verre du bouton de retour, sur le même écran, contre la même image : le hairline est la réponse quand on connaît le fond, l'ombre diffuse est la réponse quand on ne le connaît pas. Aucun autre élément, aucun autre écran. Le bouton actif de la navbar est « surélevé » (wireframe) par translation de −1 px + `accent` sur l'icône — pas d'ombre, pas de halo. Le séparateur de date est l'élévation zéro incarnée : hairline — caption — hairline, centré.

## Components

Primitives Astryx imposées (wireframe) : `SegmentedControl` (fond `accent-soft` sur l'option active), `DropdownMenu` (icône à gauche), `NavIcon` (navbar, listes de boutons), `ClickableCard`, `Toolbar` (headers), `PowerSearch` (tokens selon contexte), `Chat` (composer). Interdiction de recoder une primitive existante d'Astryx.

**Un sélecteur remplit son conteneur, et ses options se le partagent à parts égales** (11/08/2026) : `layout="fill"`, jamais le `hug` par défaut d'Astryx. Sans lui, deux ou quatre options se serrent à gauche d'un cadre trop large — l'accueil, l'onglet Activity du profil et l'écran d'informations d'une conversation le faisaient tous les trois, quand le sélecteur Actions/Activity juste au-dessus ne le faisait pas : la même primitive rendue de deux façons sur le même écran. C'est aussi ce qui donne des cibles tactiles régulières, indépendantes de la longueur des libellés.

**Rien de plus haut qu'une ligne de texte ne vit dans un `Button`** (11/08/2026) : la primitive d'Astryx est un contrôle de formulaire à hauteur fixe (`--size-element-md`, 32 px). Une vignette, un avatar, une carte y débordent de leur propre cadre et emportent l'alignement de la colonne — c'était le défaut visible de l'envoi de photo. Une image cliquable est un `<button>` transparent qui épouse son contenu (motif du zoom de `MediaViewer`) ; une carte cliquable est un `ClickableCard`. **La tuile média réserve sa boîte avant déchiffrement**, au ratio de l'original (`info.w`/`info.h`), et le Skeleton lit les deux mêmes nombres : c'est ce qui rend le « zéro layout shift » vrai au lieu d'approximatif.

**Un média a deux géométries, selon ce qu'il est à cet endroit** (11/08/2026) : dans la timeline il *est* le message, donc il garde le cadrage de son auteur, arrondi comme une carte et détaché du texte par une marge verticale. Dans une galerie il devient une **planche contact — trois carrés par ligne**, rognés au centre, sans arrondi, séparés par le plus petit écart de l'échelle (2 px). C'est la grille d'Instagram et pour sa raison : trois cadrages différents par ligne donnent des dents de scie qu'on ne balaie plus, et le pavage régulier est ce qui rend une galerie lisible d'un coup d'œil. Trois colonnes en `1fr`, jamais un nombre calculé ni une largeur fixe — c'est le compte qui garde une vignette reconnaissable sur un téléphone, et la galerie vit dans une colonne même sur grand écran. Les onglets de texte (épinglés, liens, fichiers) restent une liste : une ligne de lien n'est pas une vignette.

**Toute feuille et toute modale offrent deux sorties, toujours les deux** (11/08/2026) : un bouton de fermeture (icône `close`, en haut à droite, dans l'en-tête quand il y en a un) **et** le clic sur le fond. Il n'y a pas de touche Échap sur un téléphone : une modale qui ne se ferme qu'au clavier est un cul-de-sac, et c'en était un — cinq feuilles bloquaient le fond, dont deux sans aucun bouton de sortie. Le composant `Sheet` n'expose plus de moyen de le refuser ; une étape volontairement bloquante (clé de récupération, REQ-UI-04) se construit sur `Dialog` directement et se nomme comme telle. Le libellé du bouton est **écrit par le shard**, jamais tiré du dictionnaire d'Astryx, dont le catalogue français porte 3 clés sur 219.

**Le bottom-sheet prend toute la largeur de l'écran**, collé au bas, arrondi **en haut seulement** (r12) : ses deux coins bas entailleraient le bord contre lequel il est posé. Son en-tête reste en place et son corps défile — au-delà de sa hauteur maximale (85 dvh), un contenu long était coupé et inatteignable —, et ce corps dégage la barre de gestes en PWA installée. La géométrie par défaut de `Dialog` est celle d'un dialogue de bureau (400 px, centré) : elle est reprise par le shard pour l'ancrage bas, jamais recopiée écran par écran.

**La barre d'écriture est une rangée, au bas de la fenêtre** (11/08/2026, escalade E-16) : `[+] [champ] [photo] [envoyer]` sur **une seule ligne**, et l'écran Conversation est une colonne de hauteur fixée dont la timeline est la seule partie qui défile. Ce n'est pas un goût — dans une messagerie on écrit dix fois plus souvent qu'on ne joint : le champ prend toute la largeur restante, les gestes rares se réduisent à des cibles carrées à ses deux bouts, et un libellé y coûterait la largeur qui revient au texte. Le champ est la **seule surface** de la rangée (e1 : `surface` + filet, rayon `--radius-chat`) ; les boutons sont nus autour, trois cadres côte à côte feraient trois boîtes à lire. Les boutons s'alignent sur la **dernière ligne** du champ (`flex-end`), pas sur son milieu, pour qu'ils suivent le texte quand il grandit. Le message cité (réponse, modification) prend sa propre ligne au-dessus : c'est un bloc de texte, il ne partage pas la ligne d'une icône. **`ChatComposer` d'Astryx n'est pas utilisé** — son corps est une colonne dont la rangée d'actions est rendue sous le champ, inconditionnellement : la forme d'un composer d'assistant. Le champ (`ChatComposerInput`) est repris tel quel, la rangée est composée par le shard ; aucune primitive n'est recodée.

**Un parcours d'accueil dit où il en est, et attend là où il travaille** (24/08/2026, REQ-UI-22) : `ProgressBar` en haut de l'écran, avec son libellé — « Étape 2 sur 4 » —, parce qu'une barre seule montre une avancée sans jamais répondre à la question qu'on se pose (« c'est encore long ? »). Une étape qui doit fabriquer quelque chose avant d'avoir un contenu — dessiner deux images, ouvrir un salon — rend un `Spinner` **à la place de ce contenu**, la barre restant lisible au-dessus : c'est la seule exception au « pas de spinner » ci-dessous, et elle n'en est pas une — l'interdit vise le spinner **plein écran**, celui qui masque l'application entière. Un skeleton ne conviendrait pas ici : il annonce une géométrie finale, or l'écran qui vient n'a pas la forme de celui qui attend, et ce qu'il faut dire n'est pas « ça arrive » mais « on est en train de le faire ». Une étape facultative pose sa sortie en `ghost` **sous** le contenu ; une étape bloquante n'en pose aucune — un bouton grisé serait une promesse non tenue.

Composants composés (les 26 du wireframe, mappés dans `specs/ui/00-plan-frontend.md`) : un composant = un fichier nommé, réutilisé partout, variations par props. Obligations transverses : états chargement (Skeleton de même géométrie que le contenu final, zéro layout shift), vide (Placeholder — icône au trait monochrome, pas d'illustration cartoon), erreur et hors ligne ; rendu correct dans les deux thèmes ; avatars en carré arrondi partout, au rayon de `--tacita-radius-avatar` (ConversationAvatar est le seul endroit qui rend un avatar — **image quand le profil en porte une, initiales sinon** ; le `mxc://` se résout par un fetch authentifié, jamais par un `src` direct, l'endpoint média exigeant le jeton). L'écran profil se lit en trois couches : bannière au fond, bandeau d'actions flottant par-dessus, avatar remonté sur la bannière — les deux images se dissolvent par le bas au `mask-image`, jamais par un calque qui devrait connaître la couleur du fond. **La bannière ne se rend qu'en partie** (`.tacita-banniere`, 11/08/2026) : c'est un fond, et à pleine force une photo choisie par l'utilisateur entre en concurrence avec l'avatar et le nom posés dessus — l'écran perd son premier élément, exactement le défaut que le passage sur rail avait corrigé pour la position. L'avatar et le bandeau sont ses frères et gardent leur pleine force, ce qui est le point : l'écart entre les deux est ce qui désigne le sujet. Un `opacity` sur la couche, pas une alpha dans le masque — le masque dit *où* l'image s'éteint, la règle dit *à quelle force* elle se rend ailleurs ; les deux se multiplient, et les garder séparés permet de régler l'un sans redessiner l'autre. Cette opacité vit dans une **feuille**, jamais dans un `style` inline : le CSSOM valide `opacity` comme un nombre et réduit un `var()` inline à `NaN`, sans effet et sans bruit. **La rampe de ces deux masques suit un `smoothstep`, pas une pente droite** (11/08/2026) : un dégradé linéaire fait varier l'alpha à vitesse constante, et l'œil lit les deux ruptures de pente — au départ et à l'arrivée — comme des lignes, ce qui donnait un fondu visiblement coupé alors qu'il était bien un dégradé. La courbe part et finit à pente nulle, donc sans arête ; les distances de fondu ne changent pas, seule la façon d'y arriver — et elles restent une géométrie du composant, mesurée à l'œil sur l'écran réel, pas un barème que ce fichier arbitre. C'est un adoucissement de masque, pas un dégradé de surface : le §4 Overview interdit toujours les dégradés **décoratifs**, et celui-ci ne peint aucune couleur — il ne fait qu'éteindre une image. **Son identité est alignée sur le rail gauche** (`--spacing-3`, la gouttière commune à tous les écrans) : avatar, nom et identifiant partagent une verticale avec les cartes qui les suivent. Centrer cette colonne dépensait la position — la dimension de hiérarchie la moins chère — en symétrie, et obligeait la bannière à s'échapper du centrage de son propre parent. Traits signature à préserver : regroupement Discord des messages (règle des 5 minutes), coches vertes, séparateur de date au filet, forme d'onde des vocaux en barres verticales strictes sur la grille.

## Do's and Don'ts

**Do**
- Tokens uniquement ; nouvelle couleur = modification de ce fichier (validée Tech Lead), jamais du composant.
- Une valeur propre à **un** composant se règle dans son token, jamais recopiée en prose ici : ce fichier dit à quoi le token sert et ce qu'il interdit, le token dit combien. Un nombre écrit aux deux endroits finit par diverger, et c'est alors la prose qu'on croit.
- Aligner tout sur la grille de 4 pt ; en cas de doute, plus d'espace plutôt qu'un trait de plus.
- Animations 120–180 ms, ease-out, transform/opacity uniquement ; le mouvement confirme, il ne divertit pas.
- Gestes : seuils d'axe et de distance, zone morte de 20 px au bord gauche pour le swipe droit sur message ; chaque geste a un équivalent visible.
- Le texte reçu d'autrui est insécable par nature (URL, mot collé) : la coupure se règle une fois pour toutes sur `body` en `overflow-wrap: anywhere`, jamais composant par composant. `break-word` ne compte pas dans la largeur minimale intrinsèque : il coupe le texte et laisse la page s'élargir quand même. Une ligne qui ne s'enroule pas (`maxLines`) échappe à la règle — c'est à son conteneur d'accepter de rétrécir.
- Libellés honnêtes sur les limites (réactions en clair, « délivré » non standard, note locale, périmètre de recherche) — une phrase sobre, non modale.
- Permissions demandées au moment de l'usage, chemin de rattrapage en réglages.

**Don't**
- Pas de Tailwind, shadcn, Bootstrap, CSS-in-JS tiers ; pas de copie des couleurs WhatsApp/iMessage — notre vert est profond et rare, pas un vert d'état.
- Pas de dégradés, glass, néon, blobs, mode sombre « stylé » : le sombre est un réglage d'usage, pas une esthétique. Seule exception, ratifiée et bornée : le bouton de retour du profil (`glass`, cf. Overview §4) — un second usage est un écart, pas un précédent, y compris sur les autres boutons du même bandeau.
- Pas de spinner plein écran : skeletons localisés. Pas d'état vide brut : toujours Placeholder.
- Pas d'option grisée sans explication, pas de « coming soon », rien d'affiché qui ne marche pas.
- Pas de pastille rouge de culpabilisation ; `danger` réservé au destructif ; pas de modale d'interruption hors action destructive.
- Jamais de contenu déchiffré dans les logs, la télémétrie ou le cache SW — aucun corps de message dans un message d'erreur.
