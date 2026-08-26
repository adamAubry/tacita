"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  IconeAccueil,
  IconeMentions,
  IconeProfil,
  IconeRecherche,
} from "./icons";
import { Text } from "./primitives";

/** quatre onglets, icône et libellé, dans l'ordre du wireframe. */
export const ONGLETS = [
  { href: "/", libelle: "Accueil", icone: IconeAccueil },
  { href: "/recherche", libelle: "Recherche", icone: IconeRecherche },
  { href: "/mentions", libelle: "Mentions", icone: IconeMentions },
  { href: "/profil", libelle: "Profil", icone: IconeProfil },
] as const;

/**
 * Le liseré entre le dock et la pastille, en pixels — `--spacing-1`.
 *
 * En dur ici parce que le JavaScript en a besoin autant que le style : c'est la marge à
 * retrancher pour convertir une abscisse de doigt en numéro d'onglet. Deux écritures de
 * la même valeur diveregeraient au premier ajustement ; celle-ci est la seule.
 */
const LISERE = 4;

/**
 * Distance au-delà de laquelle un appui devient un glissement, en pixels.
 *
 * DESIGN.md § Do's exige un « seuil de distance » pour tout geste. En deçà, le doigt n'a
 * fait que trembler : c'est un tap, et c'est le `<a href>` natif qui navigue.
 */
const SEUIL_GLISSEMENT = 8;

/**
 * navbar fixée en bas, navigation **sans rechargement** (`next/link`).
 *
 * ## L'onglet courant
 *
 * Trois marques, et aucune n'est une ombre ni un halo — l'interdit de DESIGN.md
 * § Elevation porte sur la profondeur simulée, pas sur la couleur : translation de −1 px,
 * accent sur l'icône **et** sur le libellé, pastille `accent-soft` autour des deux (que
 * DESIGN.md § Colors donne précisément pour « selector actif »), et l'icône à 28 px
 * contre 24.
 *
 * Pourquoi trois plutôt qu'une : la couleur seule ne survit ni au daltonisme ni à un
 * écran en plein soleil, et c'est la seule information permanente de la barre. La taille
 * et la pastille la portent sans elle.
 *
 * Cibles de 44 px minimum (M-A) et `env(safe-area-inset-bottom)` : sans ça, en PWA
 * installée sur iOS, le dernier onglet passe sous la barre de gestes du système.
 *
 * ## Le dock
 *
 * La barre ne touche aucun bord : centrée, décollée du bas, plafonnée à 420 px. Elle
 * cesse d'être une lisière de l'écran pour devenir un objet posé dessus — c'est ce que
 * fait le dock d'exemple (`.screens/example-navbar.tsx`), et c'est ce que DESIGN.md
 * appelle e2 : `surface-raised`, filet, ombre 0 2 8 à 8 %.
 *
 * Deux stades concentriques : le dock, et la pastille à `LISERE` à l'intérieur.
 * `--radius-full` sur les deux est un **écart assumé** à DESIGN.md, dont l'échelle de
 * rayons plafonne à r12 — voir la note à l'endroit où il est posé.
 *
 * ## Le libellé est dans la mise en page, pas dans un survol
 *
 * Icône en haut, libellé en dessous, en permanence. Ce que ça remplace : un tooltip qui
 * n'apparaissait qu'au survol ou au maintien. Une information permanente n'a pas besoin
 * d'être révélée, et un libellé visible **est** la cible de 44 px plutôt que d'être posé
 * au-dessus d'elle. C'est aussi le motif des Info buttons : une icône a le
 * même poids visuel où qu'elle se trouve dans l'app.
 *
 * ## La pastille se déplace au doigt
 *
 * Poser le doigt sur la barre et le faire glisser déplace la pastille de cellule en
 * cellule ; l'icône atteinte se soulève — le retour que la souris obtient au survol — et
 * le relâchement navigue vers l'onglet atteint. C'est le geste du sélecteur de clavier
 * iOS : on vise en glissant, on valide en relâchant, et rien n'est engagé tant que le
 * doigt touche l'écran.
 *
 * Trois choses le rendent simple, et elles viennent d'ailleurs :
 *
 * - **Les cellules sont égales** (`flex: 1`). L'onglet sous le doigt est une division,
 *   pas un test de collision sur quatre rectangles mesurés.
 * - **La pastille est un élément à part**, en position absolue, et non le fond de
 *   l'onglet actif. C'est ce qui lui permet de *glisser* d'une cellule à l'autre plutôt
 *   que de s'éteindre ici pour se rallumer là.
 * - **`setPointerCapture`, mais au franchissement du seuil seulement** : sans lui, le
 *   doigt qui sort de la barre — vers le haut, ce qui arrive tout le temps — cesse d'être
 *   suivi et le geste meurt en cours de route. Pris au *poser*, en revanche, il
 *   retargeterait aussi les événements souris de compatibilité et tuerait le clic natif
 *   du tap. Il n'est donc pris que quand le geste a cessé d'être un tap.
 *
 * **Deux états et non un**, parce qu'un doigt qui se lève et une route qui change ne se
 * produisent pas au même instant : `pointe` est l'onglet sous le doigt et retombe avec
 * lui, `intention` est l'onglet choisi et tient jusqu'à ce que la route l'ait rejoint. Un
 * seul état les confondait, et la pastille revenait à l'onglet *quitté* pendant toute la
 * durée du changement d'écran avant d'y resauter — visible au tap, où le geste est trop
 * court pour masquer l'aller-retour.
 *
 * Ce qui n'est **pas** cassé au passage : un tap reste un tap. En deçà de
 * `SEUIL_GLISSEMENT`, on ne touche à rien et c'est le `<a href>` de `next/link` qui
 * navigue, avec son préchargement et son clic natif. Le clavier n'est pas concerné du
 * tout — il n'émet aucun événement de pointeur, et `Entrée` sur un lien reste un clic.
 *
 * `touch-action: none` sur la barre : sans lui, le navigateur interprète le glissement
 * horizontal comme un début de défilement et vole le pointeur au premier pixel.
 */
export function Navbar() {
  const chemin = usePathname();
  const routeur = useRouter();
  const barre = useRef<HTMLElement>(null);

  // L'onglet **sous le doigt**, `null` dès que le doigt est levé. Ne sert qu'au
  // soulèvement de l'icône : c'est un retour au contact, il n'a pas à survivre au contact.
  const [pointe, setPointe] = useState<number | null>(null);
  // L'onglet **où l'on va**, posé au relâchement et tenu jusqu'à ce que la route y soit.
  //
  // C'est lui qui règle le défaut du tap : la navigation est asynchrone, et remettre la
  // pastille à `indexActif` au `pointerup` la renvoyait à l'onglet *quitté* pendant tout
  // le temps du changement d'écran, avant qu'elle ne resaute à l'arrivée. Le doigt disait
  // déjà où il allait — la barre n'a aucune raison de l'oublier en chemin.
  const [intention, setIntention] = useState<number | null>(null);
  // Hors du rendu : aucun des trois ne doit provoquer de re-rendu, et tous sont lus dans
  // des handlers qui suivent le même geste.
  const enCours = useRef(false);
  const depart = useRef(0);
  const aGlisse = useRef(false);

  const indexActif = ONGLETS.findIndex(({ href }) =>
    // `/` ne doit être actif que sur lui-même, sinon les quatre onglets s'allument sur
    // la racine.
    href === "/" ? chemin === "/" : chemin.startsWith(href),
  );
  // Le doigt prime sur l'intention, qui prime sur la route. `-1` quand la route n'est
  // aucun des quatre : la pastille se pose alors sur le premier onglet plutôt que de
  // sortir de la barre.
  const montre = pointe ?? intention ?? Math.max(indexActif, 0);

  // La route a rattrapé l'intention : l'état local n'a plus rien à ajouter, et le rendu
  // ne bouge pas d'un pixel puisque les deux désignent désormais le même onglet.
  useEffect(() => setIntention(null), [chemin]);

  /** L'onglet sous une abscisse, ou `null` si le doigt est sorti par un côté. */
  const onglenSous = (clientX: number) => {
    const boite = barre.current?.getBoundingClientRect();
    if (!boite) return null;
    const utile = boite.width - LISERE * 2;
    const x = clientX - boite.left - LISERE;
    if (x < 0 || x > utile) return null;
    return Math.min(
      ONGLETS.length - 1,
      Math.floor((x / utile) * ONGLETS.length),
    );
  };

  return (
    <nav
      ref={barre}
      aria-label="Navigation principale"
      onPointerDown={(evenement) => {
        // Clic droit et clic du milieu ouvrent des menus et des onglets : ils ne sont pas
        // à nous. Sur tactile, `button` vaut toujours 0.
        if (evenement.button !== 0) return;
        enCours.current = true;
        aGlisse.current = false;
        depart.current = evenement.clientX;
        setPointe(onglenSous(evenement.clientX));
      }}
      onPointerMove={(evenement) => {
        if (!enCours.current) return;
        if (
          !aGlisse.current &&
          Math.abs(evenement.clientX - depart.current) > SEUIL_GLISSEMENT
        ) {
          aGlisse.current = true;
          // La capture est prise **ici**, au franchissement du seuil, et non au poser.
          // Prise au poser, elle retargete aussi les événements souris de compatibilité :
          // le `click` d'un simple tap serait dispatché sur la barre et jamais sur le
          // `<a>`, et la navigation native mourrait avec lui. Un tap ne capture donc
          // rien ; seul un geste devenu glissement le fait, et à ce moment-là c'est nous
          // qui naviguons de toute façon.
          evenement.currentTarget.setPointerCapture(evenement.pointerId);
        }
        // `?? precedent` : sorti par un côté, on garde le dernier onglet atteint plutôt
        // que de faire disparaître la pastille au milieu du geste.
        setPointe((precedent) => onglenSous(evenement.clientX) ?? precedent);
      }}
      onPointerUp={(evenement) => {
        if (!enCours.current) return;
        enCours.current = false;
        const cible = onglenSous(evenement.clientX);
        // Le doigt est parti, mais la pastille reste où il l'a laissée : elle attend que
        // la route la rejoigne. Relâché hors de la barre, `cible` est `null` et elle
        // repart d'elle-même vers l'onglet courant — rien n'a été choisi.
        setPointe(null);
        setIntention(cible);
        // Un tap n'est pas un glissement : on laisse le `<a href>` faire son travail,
        // sinon on naviguerait deux fois pour un seul doigt.
        const onglet = cible === null ? undefined : ONGLETS[cible];
        if (aGlisse.current && onglet) routeur.push(onglet.href);
      }}
      // Le défilement vole le pointeur, une notification système aussi : sans ça, la
      // pastille resterait sous un doigt qui n'existe plus.
      onPointerCancel={() => {
        enCours.current = false;
        aGlisse.current = false;
        // Rien n'a été relâché, donc rien n'a été choisi : les deux repartent, et la
        // pastille retourne à la route.
        setPointe(null);
        setIntention(null);
      }}
      style={{
        position: "fixed",
        // `insetInline: 0` + `marginInline: auto` sur une largeur au contenu : le dock se
        // centre sans `translateX(-50%)`, qui écraserait toute transform posée dessus.
        insetInline: 0,
        marginInline: "auto",
        // Largeur fluide et non `fit-content` : c'est la barre qui donne la mesure, et les
        // quatre onglets s'y partagent l'espace à parts égales (`flex: 1` plus bas). Plus
        // aucun écart à régler entre eux — il n'y en a plus, chacun *est* son quart.
        width: "calc(100% - var(--spacing-3) * 2)",
        maxWidth: 420,
        bottom: "calc(var(--spacing-3) + env(safe-area-inset-bottom, 0px))",
        display: "flex",
        alignItems: "center",
        gap: 0,
        // Hauteur fixe plutôt que padding + `min-height` : `box-sizing: border-box` est
        // global, donc 60 px incluent le filet, et le dégagement que le layout réserve se
        // déduit de ce seul nombre.
        height: 60,
        // Pour égaler la marge verticale : les deux stades deviennent alors
        // **concentriques**. Sans ce liseré, la pastille du premier onglet sortirait de
        // la courbe du dock — à 4 px du haut, le bord du stade extérieur est encore à
        // 16 px de l'origine, pas à 0.
        paddingInline: LISERE,
        // Sans lui, le navigateur lit le glissement horizontal comme un défilement et
        // s'empare du pointeur avant le premier `pointermove`.
        touchAction: "none",
        // e2 de DESIGN.md — jamais d'ombre sans filet.
        background: "var(--color-background-popover)",
        border: "1px solid var(--color-border)",
        // Extrémités pleinement rondes. **Écart assumé à DESIGN.md**, dont la géométrie
        // de référence plafonne à r12 : un stade n'est pas un « coin très arrondi » mais
        // il sort de l'échelle des rayons. À porter dans DESIGN.md, pas à oublier ici.
        borderRadius: "var(--radius-full)",
        boxShadow: "var(--shadow-low)",
      }}
    >
      {/*
        La pastille. Un élément à part, et non le fond de l'onglet actif : c'est ce qui
        lui permet de glisser d'une cellule à l'autre au lieu de s'éteindre ici pour se
        rallumer là. `aria-hidden` — elle ne dit rien qu'`aria-current` ne dise déjà.

        Les quatre côtés sont posés à `LISERE` du dock, donc sa hauteur se déduit de celle
        de la barre plutôt que d'être un nombre de plus à tenir à jour.
      */}
      <span
        aria-hidden
        className="navbar-curseur"
        style={{
          position: "absolute",
          left: LISERE,
          top: LISERE,
          bottom: LISERE,
          width: `calc((100% - ${LISERE * 2}px) / ${ONGLETS.length})`,
          // Un pourcentage de `translate` se rapporte à la largeur de l'élément lui-même,
          // qui vaut exactement une cellule : le décalage est le numéro de l'onglet.
          transform: `translateX(${montre * 100}%)`,
          borderRadius: "var(--radius-full)",
          background: "var(--color-accent-muted)",
          transition: "transform var(--duration-fast) var(--ease-standard)",
        }}
      />
      {ONGLETS.map(({ href, libelle, icone }, index) => {
        const dessus = index === montre;
        return (
          <Link
            key={href}
            href={href}
            className="navbar-onglet"
            aria-label={libelle}
            aria-current={index === indexActif ? "page" : undefined}
            style={{
              // Parts égales. C'est ce qui remplace l'écart entre onglets : quatre
              // colonnes de même largeur, quel que soit le libellé — « Profil » reçoit
              // autant de place que « Recherche », et la barre les enveloppe sans reste.
              flex: 1,
              // Au-dessus de la pastille, qui est son fond et non son voisin.
              position: "relative",
              display: "grid",
              justifyItems: "center",
              alignContent: "center",
              // Zéro : icône et libellé sont **une** étiquette, pas deux éléments empilés.
              // L'air qui les sépare encore est celui de l'interligne du libellé.
              gap: 0,
              minWidth: 44,
              minHeight: 44,
              // Un plancher, pas une mesure : la largeur vient du `flex: 1`. Il ne sert
              // qu'à empêcher le libellé de toucher les bords de sa pastille sur un
              // écran étroit.
              paddingInline: "var(--spacing-2)",
              paddingBlock: "var(--spacing-1)",
              // Un onglet est une destination, pas un lien dans une phrase : le
              // soulignement par défaut du navigateur n'a rien à souligner ici.
              textDecoration: "none",
              color: dessus
                ? "var(--color-icon-accent)"
                : "var(--color-icon-secondary)",
              transform: dessus ? "translateY(-1px)" : undefined,
              transition:
                "transform var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)",
            }}
          >
            <span
              className="navbar-icone"
              // La taille de l'icône suit le doigt, pas la route : pendant un geste, une
              // pastille posée sur « Mentions » avec l'icône d'« Accueil » restée grande
              // montrerait deux sélections à la fois.
              data-dessus={dessus || undefined}
              style={{
                display: "grid",
                placeItems: "center",
                // Hauteur fixe, à la taille de la plus grande des icônes : sans elle, les
                // 28 px de l'onglet visé pousseraient son libellé 2 px plus bas que ceux
                // des trois autres. La largeur reste libre, la pastille est réglée par le
                // libellé qui est toujours le plus large des deux.
                height: 28,
                // Le soulèvement que la souris obtient au survol, ici sous le doigt. Sur
                // `pointe` et non `montre` : c'est un retour au contact, il retombe quand
                // le doigt se lève même si la pastille, elle, reste. En style inline parce
                // qu'il est piloté par l'état ; la règle `:hover` de `tokens.css` reste,
                // elle, pour la souris qui ne presse pas.
                transform: pointe === index ? "translateY(-4px)" : undefined,
                transition:
                  "transform var(--duration-fast) var(--ease-standard)",
              }}
            >
              {icone}
            </span>
            {/* `color="inherit"` : sans lui, `supporting` impose `--color-text-secondary`
                et le libellé de l'onglet actif resterait gris sous une icône verte.

                `size="xsm"` : c'est `--font-size-xs`, soit les 12 px que DESIGN.md appelle
                `caption` — la plus petite taille de son échelle. Astryx recommande de s'en
                tenir au `type` seul, mais notre thème ne mappe aucun type sur `caption` :
                c'est `supporting` (13) pour la graisse et l'interligne, `xsm` pour la
                taille. */}
            <Text type="supporting" size="xsm" color="inherit" maxLines={1}>
              {libelle}
            </Text>
          </Link>
        );
      })}
    </nav>
  );
}
