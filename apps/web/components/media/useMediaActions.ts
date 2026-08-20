"use client";

import type { Session } from "@tacita/client-core";
import { downloadAttachment, saveOriginal } from "@tacita/media-pipeline";
import { useCallback, useMemo } from "react";

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
  const env = useMemo(() => environnementMedia(), []);

  const telecharger = useCallback<Telecharger>(
    async (fichier, mimeType) => {
      if (!session) throw new Error("session absente : aucun média déchiffrable");
      const octets = await downloadAttachment(session, env, fichier);
      // Le type est celui que l'UI attend pour l'affichage, pas celui du blob chiffré :
      // le pipeline rend des octets nus, sans en-tête de contenu.
      return new Blob([octets as BlobPart], { type: mimeType ?? "application/octet-stream" });
    },
    [session, env],
  );

  /** REQ-MED-05 — le déchiffrement puis le choix de destination, délégué au pipeline. */
  const sauvegarder = useCallback(
    (media: Media) => {
      void telecharger(media.fichier, media.mime).then((blob) =>
        saveOriginal(env, blob, media.nom),
      );
    },
    [telecharger, env],
  );

  return { env, telecharger, sauvegarder };
}
