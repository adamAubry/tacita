import { Avatar, Style } from "@dicebear/core";
import constellation from "@dicebear/styles/constellation.json";
import glyphs from "@dicebear/styles/glyphs.json";
import type { Session } from "@tacita/client-core";

import { profileOf, updateProfile } from "./social";

/**
 * **l'identité visuelle d'un compte neuf**, dessinée sur l'appareil.
 *
 * Un compte fraîchement créé n'a ni photo ni bannière : la carte de profil affiche alors
 * des initiales sur un aplat d'accent, et toutes les cartes de l'app se ressemblent. Ces
 * deux images ne demandent rien à personne et ne dépendent d'aucun service : DiceBear est
 * une bibliothèque locale, déterministe, sans réseau — le seul point d'entrée qui compte
 * ici est que **rien ne part chez un tiers**, ni le seed ni le rendu (interdit n°8 :
 * l'identifiant Matrix est public, mais il ne sort pas pour autant de l'app).
 *
 * Le seed est l'identifiant Matrix : il est stable pour la vie du compte, donc l'image
 * l'est aussi — la même personne recréerait exactement les mêmes images sur un autre
 * appareil. Un tirage aléatoire aurait donné une identité qui change à chaque tentative.
 *
 * `Style` est instancié une fois par module et non par appel : la définition est un JSON
 * de quelques dizaines de kilo-octets, et la reparcourir à chaque avatar ne sert à rien
 * (c'est aussi la forme que la v11 de DiceBear imposera — la passer en brut à `Avatar`
 * est déjà déprécié).
 */
const GLYPHS = new Style(glyphs);
const CONSTELLATION = new Style(constellation);

/**
 * 512 px de côté. Les deux images passent ensuite par la compression du pipeline (spec
 * 08), qui les réduit à la cible du réseau : ce nombre n'est donc pas la taille
 * transmise, seulement la résolution à laquelle le SVG est tramé. Assez pour un avatar
 * de 128 pt en écran x3, et assez pour une bannière recadrée en `cover`.
 */
export const TAILLE_IDENTITE = 512;

/**
 * les deux SVG, tels que DiceBear les rend. Rendus **en clair** parce
 * qu'ils sont publics au même titre que la photo qu'ils remplacent.
 *
 * Deux styles distincts et pas un seul décliné : l'avatar est une forme unique et
 * lisible à 32 px (« glyphs »), la bannière est une texture qui doit supporter d'être
 * recadrée n'importe où (« constellation »). Le même style aux deux places aurait donné
 * une carte qui se répète.
 */
export function imagesParDefaut(seed: string): { avatar: string; banniere: string } {
  return {
    avatar: new Avatar(GLYPHS, { seed, size: TAILLE_IDENTITE }).toString(),
    banniere: new Avatar(CONSTELLATION, { seed, size: TAILLE_IDENTITE }).toString(),
  };
}

/**
 * pose les images par défaut sur son propre profil, **sans jamais écraser
 * ce que le compte a déjà**. Les deux champs sont regardés séparément : quelqu'un qui a
 * choisi sa photo mais pas sa bannière ne perd pas sa photo.
 *
 * `televerser` est injecté et non appelé ici pour la même raison que `onPhoto` dans M-G :
 * ce paquet ne connaît pas le pipeline média, et veut que les sites d'appel du
 * chemin public restent comptables un par un. Il reçoit un SVG et rend le `mxc://`.
 *
 * Appelée à la création du compte (M-B). L'appeler deux fois ne fait rien la seconde
 * fois : c'est ce qui la rend sûre depuis un effet React, où rien ne garantit un
 * déclenchement unique.
 */
export async function poserImagesParDefaut(
  session: Session,
  televerser: (svg: string) => Promise<string>,
): Promise<void> {
  const userId = session.client.getUserId();
  if (!userId) return;

  const profil = await profileOf(session, userId);
  if (profil.avatarUrl && profil.bannerUrl) return;

  const images = imagesParDefaut(userId);
  await updateProfile(session, {
    ...(profil.avatarUrl ? {} : { avatarUrl: await televerser(images.avatar) }),
    ...(profil.bannerUrl ? {} : { bannerUrl: await televerser(images.banniere) }),
  });
}
