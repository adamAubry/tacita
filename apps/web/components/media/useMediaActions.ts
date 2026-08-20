"use client";

import type { Session } from "@tacita/client-core";
import {
  downloadAttachment,
  downloadAttachmentToFile,
  estRendable,
  saveOriginal,
} from "@tacita/media-pipeline";
import { useCallback, useMemo, useRef } from "react";

import type { MediaEnvironment } from "@tacita/media-pipeline";

import { environnementMedia } from "../../lib/media-env";
import type { Media, Telecharger } from "./media";

/**
 * Les deux gestes que tout écran portant des médias doit savoir faire : déchiffrer pour
 * afficher, et écrire sur l'appareil (REQ-MED-05).
 *
 * Ici plutôt que trois fois : `Conversation`, `InfosConversation` et `EcranProfil`
 * portaient la même closure `telecharger`, recopiée à l'identique. Aucun des trois
 * n'avait de quoi *sauvegarder* un média — seul le viewer plein écran le pouvait, parce
 * que son câblage l'avait écrit une quatrième fois. Un fichier qui n'ouvre pas de viewer
 * (PDF, ZIP, document) n'avait donc aucune sortie, alors que les octets étaient là.
 *
 * L'environnement média est créé **une fois par écran** : il ouvre un `AudioContext` et
 * lit `navigator.connection`, ni l'un ni l'autre à refaire à chaque rendu. Il est rendu
 * avec les deux gestes parce que les écrans en ont besoin par ailleurs — envoi, capture
 * photo, transcodage —, et qu'un second `environnementMedia()` à côté de celui-ci
 * ouvrirait un second `AudioContext` pour le même écran.
 */
export function useMediaActions(session: Session | null) {
  /**
   * REQ-MED-13 — la dernière chose que le pipeline a dû abandonner, déposée ici.
   *
   * Une boîte plutôt qu'un état React : l'avis se lit **juste après** l'appel qui l'a
   * produit, dans la même fonction, et n'a aucune raison de provoquer un rendu par
   * lui-même. C'est l'appelant qui décide s'il en fait un message.
   */
  const avis = useRef<Parameters<NonNullable<MediaEnvironment["signaler"]>>[0] | undefined>(undefined);
  const env = useMemo(
    () => environnementMedia({ signaler: (recu) => { avis.current = recu; } }),
    [],
  );

  const telecharger = useCallback<Telecharger>(
    async (fichier, mimeType) => {
      if (!session) throw new Error("session absente : aucun média déchiffrable");
      const octets = await downloadAttachment(session, env, fichier);
      /*
       * Le type est celui que l'UI attend pour l'affichage, pas celui du blob chiffré :
       * le pipeline rend des octets nus, sans en-tête de contenu.
       *
       * REQ-MED-12 — **et c'est le dernier verrou avant `URL.createObjectURL`.** Un type
       * hors liste close ne devient jamais le type d'un Blob, quel que soit l'appelant :
       * la garde est ici, à l'endroit unique par où passent la timeline, la galerie et le
       * viewer, et non dans chacun des trois. Un appelant qui demanderait `text/html`
       * obtient des octets opaques — donc rien de rendable, ce qui est exactement le
       * verdict de la REQ.
       */
      return new Blob([octets as BlobPart], {
        type: estRendable(mimeType) ? mimeType : "application/octet-stream",
      });
    },
    [session, env],
  );

  /**
   * REQ-MED-05 / REQ-MED-15 — le déchiffrement puis le choix de destination, délégué au
   * pipeline. **Par tranches quand la plateforme le permet** : sur une vidéo de 400 Mo
   * reçue d'un client tiers, le chemin d'un seul bloc fait coexister le chiffré, le clair
   * et le Blob — trois fois la taille du fichier, et l'onglet meurt sur mobile.
   *
   * Le repli n'est pas une dégradation silencieuse : c'est `verdictTaille` qui a déjà
   * refusé, en amont, ce que ce repli ne saurait pas porter.
   */
  const sauvegarder = useCallback(
    (media: Media) => {
      if (!session) return;
      void (env.ouvrirEcriture
        ? downloadAttachmentToFile(session, env, media.fichier, media.nom)
        : telecharger(media.fichier, media.mime).then((blob) => saveOriginal(env, blob, media.nom)));
    },
    [session, telecharger, env],
  );

  return { env, avis, telecharger, sauvegarder };
}
