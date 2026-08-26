"use client";

import { useRef, useState, type PointerEvent } from "react";

/**
 * Distance minimale d'un glissement. Deux seuils et pas un : la distance seule ferait
 * agir un doigt qui descend la liste en biais, d'où la tolérance verticale.
 */
export const SEUIL_GLISSEMENT = 64;
const TOLERANCE_VERTICALE = 32;

/**
 * **zone morte de 20 px au bord gauche.** Un glissement vers la droite qui
 * part du bord déclenche le retour arrière de Safari iOS hors standalone : le geste
 * n'arrive jamais jusqu'à nous, et la page a changé. On ne peut pas l'empêcher, on peut
 * refuser d'agir dessus — sinon l'utilisateur voit *les deux* se produire selon la
 * chance qu'il a eue de partir à 19 ou 21 px.
 */
export const ZONE_MORTE_BORD = 20;

/** Appui long avant le hold menu. En dessous, un tap lent ouvrirait le menu. */
export const DUREE_APPUI_LONG = 500;

/**
 * Au-delà de quoi le doigt « glisse » et n'« appuie » plus.
 *
 * **C'est ce seuil qui manquait, et c'est lui qui cassait la réponse par glissement.**
 * L'appui long n'était annulé qu'au relâchement : un glissement tranquille — le geste
 * normal, on ne balaie pas un message en 200 ms — franchissait les 500 ms en route, le
 * hold menu s'ouvrait par-dessus, avalait le `pointerup`, et le glissement n'arrivait
 * jamais à son terme. Signalé tel quel : « slider pour répondre ne marche pas ».
 */
const SEUIL_GLISSEMENT_COMMENCE = 10;

/** Ce que le doigt peut emporter à l'écran. Au-delà, le geste est déjà acquis. */
const AMPLITUDE_MAX = 96;

export interface OptionsGlissement {
  onDroite?: () => void;
  onGauche?: () => void;
  onAppuiLong?: () => void;
  /** À activer sur tout ce qui vit dans une pile de navigation. */
  zoneMorteBord?: boolean;
}

/**
 * Le geste de glissement de l'app, en un seul endroit : carte de conversation (M-C),
 * bannière de demandes (M-C), message (M-D). Trois copies auraient dérivé sur trois
 * seuils différents, et l'utilisateur aurait senti la différence sans pouvoir la nommer.
 *
 * Rend des props à étaler sur l'élément. `touchAction: "pan-y"` en fait partie : sans
 * elle le navigateur défile pendant le geste et `pointerup` n'arrive jamais à la bonne
 * abscisse — le seuil ne serait franchi que par hasard.
 *
 * **Le contenu suit le doigt** (`transform`), et ce n'est pas une décoration : un geste
 * dont rien ne bouge ne dit ni qu'il a été pris en compte, ni dans quel sens il va, ni
 * qu'il faut aller plus loin. On lâchait donc au tiers du chemin en concluant qu'il ne
 * marchait pas. La translation s'arrête à `AMPLITUDE_MAX` — au-delà le seuil est franchi,
 * continuer à suivre le doigt ne dirait rien de plus.
 */
export function useGlissement({
  onDroite,
  onGauche,
  onAppuiLong,
  zoneMorteBord = false,
}: OptionsGlissement) {
  const depart = useRef<{ x: number; y: number } | null>(null);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ecart, setEcart] = useState(0);

  const annuler = () => {
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = null;
  };

  const finir = () => {
    annuler();
    depart.current = null;
    setEcart(0);
  };

  return {
    style: {
      touchAction: "pan-y" as const,
      transform: ecart === 0 ? undefined : `translateX(${ecart}px)`,
      // Le retour à zéro s'anime, le suivi du doigt non : sans cette distinction, chaque
      // pixel parcouru traînerait derrière le doigt. DESIGN.md — 120–180 ms, ease-out.
      transition: ecart === 0 ? "transform 140ms ease-out" : undefined,
    },

    onPointerDown(evenement: PointerEvent) {
      if (zoneMorteBord && evenement.clientX < ZONE_MORTE_BORD) {
        depart.current = null;
        return;
      }
      depart.current = { x: evenement.clientX, y: evenement.clientY };
      if (onAppuiLong) minuterie.current = setTimeout(onAppuiLong, DUREE_APPUI_LONG);
      /*
       * La capture garde les événements sur cet élément même quand le doigt en sort. Sans
       * elle, un glissement qui déborde sur le message voisin — ou qui remonte hors de la
       * carte — perd son `pointerup`, et le geste meurt sans que rien ne le dise.
       * Optionnelle : jsdom n'implémente pas `PointerEvent`, les tests envoient des
       * `MouseEvent` qui n'ont ni `pointerId` ni cette méthode.
       */
      evenement.currentTarget.setPointerCapture?.(evenement.pointerId);
    },

    onPointerMove(evenement: PointerEvent) {
      const origine = depart.current;
      if (!origine) return;

      const dx = evenement.clientX - origine.x;
      const dy = evenement.clientY - origine.y;
      if (Math.abs(dx) < SEUIL_GLISSEMENT_COMMENCE && Math.abs(dy) < SEUIL_GLISSEMENT_COMMENCE) {
        return;
      }
      // Le doigt bouge : ce n'est plus un appui, et le menu ne doit pas s'ouvrir dessous.
      annuler();

      // Un doigt qui part à la verticale descend la liste : on lui rend la main plutôt
      // que de traîner le message en biais derrière lui.
      if (Math.abs(dy) > TOLERANCE_VERTICALE) {
        depart.current = null;
        setEcart(0);
        return;
      }

      const suivi = onDroite === undefined && dx > 0 ? 0 : onGauche === undefined && dx < 0 ? 0 : dx;
      setEcart(Math.max(-AMPLITUDE_MAX, Math.min(AMPLITUDE_MAX, suivi)));
    },

    onPointerUp(evenement: PointerEvent) {
      const origine = depart.current;
      finir();
      if (!origine) return;

      const dx = evenement.clientX - origine.x;
      if (Math.abs(evenement.clientY - origine.y) > TOLERANCE_VERTICALE) return;
      if (dx >= SEUIL_GLISSEMENT) onDroite?.();
      else if (dx <= -SEUIL_GLISSEMENT) onGauche?.();
    },

    onPointerCancel: finir,
  };
}
