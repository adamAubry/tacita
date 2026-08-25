"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Text } from "../foundation/primitives";
import { dureeLisible } from "./media";

interface VoicePlayerProps {
  /** URL d'objet du blob **déchiffré**. Jamais une URL serveur. */
  source?: string;
  dureeMs: number;
  /** REQ-MED-06 — pics 0–1024 calculés à l'envoi, transportés dans l'événement. */
  ondes?: number[];
}

const HAUTEUR = 28;
const ECHELLE = 1024;

/**
 * REQ-UI-14 — lecteur vocal avec forme d'onde et durée.
 *
 * DESIGN.md : « barres verticales strictes sur la grille ». Les pics viennent de
 * l'événement (le paquet les a calculés à l'envoi, REQ-MED-06) — les recalculer à la
 * lecture demanderait de décoder tout l'audio pour dessiner un rectangle.
 *
 * La barre lue est en accent, le reste en filet : la progression se lit sans curseur.
 */
export function VoicePlayer({ source, dureeMs, ondes = [] }: VoicePlayerProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const [lecture, setLecture] = useState(false);
  const [ecoulee, setEcoulee] = useState(0);

  useEffect(() => {
    // Un changement de source (nouveau message rendu au même endroit) remet le lecteur
    // à zéro : sans ça, la progression du précédent reste affichée sur le suivant.
    setEcoulee(0);
    setLecture(false);
  }, [source]);

  const progression = dureeMs > 0 ? Math.min(ecoulee / dureeMs, 1) : 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)" }}>
      <Button
        label={lecture ? "Pause" : "Lire le message vocal"}
        variant="ghost"
        isDisabled={source === undefined}
        onClick={() => {
          const element = audio.current;
          if (!element) return;
          if (lecture) element.pause();
          else void element.play();
          setLecture(!lecture);
        }}
      />

      <div
        aria-hidden
        style={{ display: "flex", alignItems: "center", gap: 2, height: HAUTEUR, flex: 1 }}
      >
        {ondes.map((pic, rang) => (
          <span
            key={rang}
            style={{
              width: 2,
              // Une barre de hauteur nulle disparaît : le minimum de 2 px garde la
              // grille lisible sur un silence.
              height: Math.max(2, Math.round((pic / ECHELLE) * HAUTEUR)),
              borderRadius: 1,
              background:
                rang / ondes.length <= progression
                  ? "var(--color-accent)"
                  : "var(--color-border-emphasized)",
            }}
          />
        ))}
      </div>

      <Text type="supporting" color="secondary" hasTabularNumbers>
        {dureeLisible(lecture || ecoulee > 0 ? dureeMs - ecoulee : dureeMs)}
      </Text>

      {/* Élément de lecture nu : le contrôle accessible est le bouton ci-dessus, et un
          vocal n'a pas de piste de sous-titres à fournir. */}
      <audio
        ref={audio}
        src={source}
        onTimeUpdate={(evenement) => setEcoulee(evenement.currentTarget.currentTime * 1000)}
        onEnded={() => {
          setLecture(false);
          setEcoulee(0);
        }}
      />
    </div>
  );
}
