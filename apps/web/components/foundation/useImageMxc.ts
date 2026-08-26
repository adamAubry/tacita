"use client";

import { downloadPublicImage } from "@tacita/media-pipeline";
import { useEffect, useState } from "react";

import { useSession } from "../onboarding/SessionProvider";

/**
 * Un `mxc://` **public** (photo de profil, bannière) → une URL d'objet affichable.
 *
 * C'est la pièce qui manquait pour que se voie : la photo partait bien par le
 * chemin public du pipeline, `setAvatarUrl` la posait bien sur le compte, et le profil la
 * relisait bien — mais rien dans le shard ne savait la **rendre**. Les endpoints média
 * anonymes répondent 404 depuis Synapse v1.146, et une balise `img` ne sait
 * pas porter d'en-tête `Authorization` : il faut passer par un `fetch` authentifié, donc
 * par un blob, donc par une URL d'objet.
 *
 * Révoquée au démontage et à chaque changement de `mxc`, comme `useBlob` de M-E : une URL
 * d'objet non révoquée garde son blob en mémoire pour la durée du document, et sur une
 * liste de profils c'est une image par personne croisée.
 *
 * Un échec ne rend rien plutôt qu'une erreur : l'appelant a toujours les initiales, qui
 * sont vraies. Rien n'est journalisé — l'URL désigne le média d'une personne.
 */
export function useImageMxc(mxc: string | undefined): string | undefined {
  const { etat } = useSession();
  const session = etat.phase === "prete" ? etat.session : null;
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    setUrl(undefined);
    if (!session || !mxc) return;

    let objet: string | undefined;
    let vivant = true;

    void downloadPublicImage(session, mxc)
      .then((blob) => {
        if (!vivant) return;
        objet = URL.createObjectURL(blob);
        setUrl(objet);
      })
      .catch(() => {});

    return () => {
      vivant = false;
      if (objet) URL.revokeObjectURL(objet);
    };
  }, [session, mxc]);

  return url;
}
