"use client";

import { resoudreType, TAILLE_SNIFF, verdictTaille, type Bytes } from "@tacita/media-pipeline";
import {
  inscrireMedia,
  lectureProgressiveDisponible,
  retirerMedia,
} from "../../lib/media-progressif";
import { useEffect, useState, type CSSProperties } from "react";

import { useGlissement } from "../../lib/gestes";
import { Button, Text } from "../foundation/primitives";
import {
  fluxFichierDisponible,
  navigateurLit,
  seuilsAppareil,
  tailleLisible,
  type Media,
  type Telecharger,
} from "./media";

interface MediaViewerProps {
  /** Les médias du salon, dans l'ordre de la timeline : la navigation les suit. */
  medias: Media[];
  /** Index d'ouverture. */
  depart: number;
  telecharger: Telecharger;
  /**
   * REQ-MED-08 (b) — le chiffré, pour la lecture progressive. Absent ⇒ chemin d'un seul
   * bloc, inchangé : c'est ce qui garde le viewer testable sans service worker.
   */
  telechargerChiffre?: (url: string) => Promise<Uint8Array>;
  onFermer: () => void;
  /** REQ-MED-05 — sauvegarde locale, déléguée au pipeline par le câblage. */
  onSauvegarder: (media: Media) => void;
}

const ZOOM_MAX = 3;

/**
 * REQ-MED-12 — les trois façons dont un média peut ne pas s'afficher, et ce qu'on en dit.
 *
 * Un seul écran pour les trois, mais **trois phrases distinctes** : « on ne rend pas ce
 * format », « on n'a pas su l'identifier » et « ce navigateur-ci ne sait pas le lire » ne
 * demandent pas la même chose à celui qui lit. La troisième est rattrapable en changeant
 * d'appareil, les deux autres non — les confondre enverrait quelqu'un essayer un autre
 * navigateur pour rien.
 */
const REFUS = {
  "hors-liste": "Tacita n'affiche pas ce format de fichier.",
  inconnu: "Le format de ce fichier n'a pas pu être identifié.",
  codec: "Ce navigateur ne sait pas lire cette vidéo.",
  // REQ-MED-15 — les deux plafonds. Le premier est un inconfort qu'on laisse forcer, le
  // second un onglet qui meurt : deux phrases, parce que ce ne sont pas deux degrés du
  // même problème.
  lourd: "Ce fichier est trop lourd pour être lu dans l'application.",
  "trop-lourd": "Ce fichier est trop lourd pour cet appareil.",
} as const;

type Refus = keyof typeof REFUS;

/** Ce que le viewer a sous la main pour le média courant. Un état, pas deux booléens. */
type Etat =
  | { phase: "chargement" }
  | { phase: "pret"; url: string; type: string }
  | { phase: "refus"; motif: Refus };

/**
 * REQ-UIX-16 — viewer plein écran : zoom, navigation entre les médias du salon,
 * sauvegarde, fermeture par geste vers le bas.
 *
 * Le média entier n'est déchiffré **qu'ici** : la timeline se contente des vignettes. Un
 * historique de photos ouvert en plein écran une par une, c'est une seule image en clair
 * en mémoire à la fois.
 */
export function MediaViewer({
  medias,
  depart,
  telecharger,
  telechargerChiffre,
  onFermer,
  onSauvegarder,
}: MediaViewerProps) {
  const [rang, setRang] = useState(depart);
  const [zoom, setZoom] = useState<number>(1);
  const [etat, setEtat] = useState<Etat>({ phase: "chargement" });
  /** REQ-MED-15 — « ouvrir quand même », et **sur ce média-là** : le forçage ne se
   *  transporte pas au suivant, qui n'a aucune raison d'hériter d'un choix qui ne le
   *  concernait pas. */
  const [forceSur, setForceSur] = useState<string>();

  const media = medias[rang];

  /*
   * **L'URL du blob, pas l'objet `Media`** — même raison que dans `useBlob` (voir le long
   * commentaire de `MediaMessage`), et c'est ici qu'elle coûtait le plus cher.
   *
   * `Conversation` reconstruit ses `Media` à chaque tour de `/sync` : tant que l'effet
   * dépendait de l'objet, une vidéo ouverte était **re-téléchargée et re-déchiffrée
   * pendant sa lecture**, toutes les quelques secondes, et le `<video>` repartait de zéro
   * à chaque fois puisque sa source changeait. C'est le « on déchiffre 2 secondes par
   * 2 secondes » des retours d'usage.
   */
  const cle = media?.fichier.url;
  const force = forceSur !== undefined && forceSur === cle;

  useEffect(() => {
    if (!media) return;
    let objet: string | undefined;
    let progressif: string | undefined;
    let vivant = true;
    setEtat({ phase: "chargement" });

    /*
     * REQ-MED-15 — la taille décide avant tout le reste, et sans réseau : `info.size` est
     * dans l'événement. Au-delà du premier plafond il n'y a pas de lecteur ; au-delà du
     * second, et seulement faute de flux d'écriture, il n'y a rien du tout à proposer.
     */
    const flux = fluxFichierDisponible();
    const bornes = { flux, seuils: seuilsAppareil() };
    const verdict = force ? "inline" : verdictTaille(media.taille, bornes);
    if (verdict !== "inline") {
      setEtat({ phase: "refus", motif: verdict === "refus" ? "trop-lourd" : "lourd" });
      return;
    }

    /*
     * REQ-MED-12 — la résolution du type précède le téléchargement, et peut le rendre
     * inutile. `info.mimetype` est protégé par Megolm : non falsifiable par le serveur,
     * **parfaitement falsifiable par l'expéditeur**. Un type hors liste close est donc
     * refusé ici, avant qu'un seul octet ne descende — le fichier reste téléchargeable,
     * c'est de le **rendre** qu'on refuse.
     */
    const declare = resoudreType(media.mime);
    if (!declare.rendable && declare.motif !== "octets-requis") {
      setEtat({ phase: "refus", motif: declare.motif });
      return;
    }

    void (async () => {
      /*
       * REQ-MED-08 (b) — **la lecture progressive, quand les trois conditions sont là** :
       * une vidéo, des empreintes par bloc dans l'événement, et un worker qui contrôle la
       * page. Le lecteur réclame alors des plages, chacune vérifiée puis déchiffrée à la
       * demande : première image après un bloc au lieu du fichier entier.
       *
       * Les trois manquent souvent — un média d'Element n'a pas le champ, un premier
       * chargement n'a pas encore de worker — et le chemin d'un seul bloc reste dessous,
       * inchangé. Aucune régression d'interop, aucune garantie en moins.
       */
      if (
        media.msgtype === "m.video" &&
        media.blocs &&
        media.blocs.length > 0 &&
        telechargerChiffre &&
        lectureProgressiveDisponible() &&
        declare.rendable
      ) {
        const chiffre = await telechargerChiffre(media.fichier.url);
        if (!vivant) return;
        if (!navigateurLit(declare.type)) {
          setEtat({ phase: "refus", motif: "codec" });
          return;
        }
        progressif = inscrireMedia(chiffre as Bytes, media.fichier, media.blocs, declare.type);
        setEtat({ phase: "pret", url: progressif, type: declare.type });
        return;
      }

      // Sans type déclaré, le blob descend opaque : on ne lui donne un type qu'une fois
      // ses propres octets reniflés (vieux clients, ponts).
      const blob = await telecharger(media.fichier, declare.rendable ? declare.type : undefined);
      if (!vivant) return;

      const resolu = declare.rendable
        ? declare
        : resoudreType(undefined, new Uint8Array(await blob.slice(0, TAILLE_SNIFF).arrayBuffer()));
      if (!vivant) return;

      if (!resolu.rendable) {
        // `octets-requis` ne peut plus se produire ici : les octets, on les a.
        setEtat({ phase: "refus", motif: resolu.motif === "hors-liste" ? "hors-liste" : "inconnu" });
        return;
      }
      if (media.msgtype === "m.video" && !navigateurLit(resolu.type)) {
        setEtat({ phase: "refus", motif: "codec" });
        return;
      }

      objet = URL.createObjectURL(
        blob.type === resolu.type ? blob : new Blob([blob], { type: resolu.type }),
      );
      setEtat({ phase: "pret", url: objet, type: resolu.type });
    })();

    return () => {
      vivant = false;
      // Le blob en clair ne survit pas au média suivant. L'inscription non plus : ses
      // octets chiffrés sont relâchés, et l'URL virtuelle ne sert plus rien.
      if (objet) URL.revokeObjectURL(objet);
      if (progressif) retirerMedia(progressif);
    };
    // `media` est volontairement absent : `cle` **est** son identité (voir ci-dessus).
  }, [cle, telecharger, telechargerChiffre, force]);

  /*
   * `Escape` ferme, comme toute boîte de dialogue modale. Le viewer ne se fermait qu'au
   * glissement vers le bas et au bouton « Fermer » : sur un clavier, une modale plein
   * écran qu'aucune touche ne referme est un piège, et c'est la base de l'accessibilité,
   * pas un raffinement. Mesuré au navigateur le 08/08/2026 — `Escape` ne faisait rien.
   */
  useEffect(() => {
    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key === "Escape") onFermer();
    };
    globalThis.addEventListener("keydown", surTouche);
    return () => globalThis.removeEventListener("keydown", surTouche);
  }, [onFermer]);

  // Fermeture par glissement **vers le bas** : le hook raisonne en horizontal, celui-ci
  // est vertical et local — deux axes, deux gestes, aucun partage à forcer.
  const [departY, setDepartY] = useState<number | null>(null);
  const horizontal = useGlissement({
    onGauche: () => setRang((r) => Math.min(r + 1, medias.length - 1)),
    onDroite: () => setRang((r) => Math.max(r - 1, 0)),
  });

  if (!media) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Média ${rang + 1} sur ${medias.length}`}
      onPointerDown={(evenement) => {
        setDepartY(evenement.clientY);
        horizontal.onPointerDown(evenement);
      }}
      onPointerUp={(evenement) => {
        if (departY !== null && evenement.clientY - departY > 96) onFermer();
        setDepartY(null);
        horizontal.onPointerUp(evenement);
      }}
      onPointerCancel={horizontal.onPointerCancel}
      style={
        {
          position: "fixed",
          inset: 0,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          /*
           * Le viewer est le seul endroit sombre de l'app, dans les deux thèmes : une
           * photo se regarde sur un fond neutre, pas sur du blanc (DESIGN.md § Colors,
           * `viewer`).
           *
           * Ce fond était `--color-background-inverted`, le fond inversé d'Astryx — qui
           * **suit le thème** (donc blanc en sombre) et vaut exactement `text`, la couleur
           * d'encre que les boutons ghost d'Astryx posent dessus. Les quatre commandes du
           * viewer étaient de la couleur de leur propre fond : « Fermer » existait,
           * répondait au clic, et ne se voyait pas — d'où « on ne peut pas fermer une
           * photo » dans les retours d'usage.
           *
           * Les tokens d'encre sont donc redéfinis **dans la portée du viewer** : ses
           * enfants sont des composants Astryx, qui lisent ces variables et rien d'autre.
           * Les remapper ici les couvre tous, y compris ceux qu'on y ajoutera ; les
           * habiller un par un laisserait le prochain naître invisible.
           */
          background: "var(--tacita-viewer)",
          "--color-text-primary": "var(--tacita-sur-viewer)",
          "--color-icon-primary": "var(--tacita-sur-viewer)",
          "--color-text-secondary": "var(--tacita-sur-viewer-muet)",
          "--color-icon-secondary": "var(--tacita-sur-viewer-muet)",
          "--color-text-disabled": "var(--tacita-sur-viewer-muet)",
          "--color-icon-disabled": "var(--tacita-sur-viewer-muet)",
          touchAction: "none",
          zIndex: 10,
        } as CSSProperties
      }
    >
      <div style={{ display: "flex", justifyContent: "space-between", padding: "var(--spacing-2)" }}>
        <Button label="Fermer" variant="ghost" onClick={onFermer} />
        <Button label="Sauvegarder" variant="ghost" onClick={() => onSauvegarder(media)} />
      </div>

      <div style={{ display: "grid", placeItems: "center", overflow: "auto" }}>
        {etat.phase === "refus" ? (
          /* REQ-MED-12 — un état explicite, jamais un lecteur muet ou un rectangle noir :
             ce qui n'est pas rendable se dit, et propose la seule action qui reste. */
          <div style={{ display: "grid", gap: "var(--spacing-3)", justifyItems: "center", padding: "var(--spacing-4)" }}>
            <Text type="body">{REFUS[etat.motif]}</Text>
            <Text type="supporting" color="secondary">
              {etat.motif === "trop-lourd"
                ? "Ouvrez-le sur un appareil disposant de plus de mémoire."
                : "Vous pouvez le télécharger pour l'ouvrir avec une autre application."}
            </Text>
            {/* REQ-MED-15 — le poids est dans le libellé : « télécharger 412 Mo » et
                « télécharger » ne demandent pas la même décision, surtout en mobilité. */}
            {etat.motif !== "trop-lourd" && (
              <Button
                label={media.taille === undefined ? "Télécharger" : `Télécharger (${tailleLisible(media.taille)})`}
                variant="secondary"
                onClick={() => onSauvegarder(media)}
              />
            )}
            {/* Passer outre reste possible tant que le clair tient en mémoire — et
                l'avertissement est la phrase au-dessus, pas une modale de plus. */}
            {etat.motif === "lourd" && (
              <Button label="Ouvrir quand même" variant="ghost" onClick={() => setForceSur(cle)} />
            )}
          </div>
        ) : etat.phase === "pret" ? (
          media.msgtype === "m.video" ? (
            // Pas de piste de sous-titres : une vidéo envoyée par un correspondant n'en
            // porte pas, et en inventer une serait pire que son absence.
            <video src={etat.url} controls style={{ maxWidth: "100%", maxHeight: "100%" }} />
          ) : (
            // WCAG 2.1.1 — le zoom est porté par un `<button>` et non par l'image :
            // une `<img onClick>` n'est ni focusable ni actionnable au clavier, et le
            // geste n'avait aucun équivalent visible (DESIGN.md : « chaque geste a un
            // équivalent »). Le bouton est transparent et épouse l'image ; c'est le même
            // tap, avec en plus une cible que le clavier et l'assistance atteignent.
            <button
              type="button"
              aria-label={`${media.nom} — agrandir (niveau ${zoom} sur ${ZOOM_MAX})`}
              // Tap = palier suivant, puis retour à 1. Un tableau et un `indexOf` pour
              // trois entiers consécutifs, c'était une addition déguisée.
              onClick={() => setZoom((niveau) => (niveau >= ZOOM_MAX ? 1 : niveau + 1))}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "zoom-in",
                maxWidth: "100%",
                maxHeight: "100%",
              }}
            >
              <img
                src={etat.url}
                alt={media.nom}
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "center",
                  maxWidth: "100%",
                  maxHeight: "100%",
                  display: "block",
                }}
              />
            </button>
          )
        ) : (
          <Text type="supporting" color="secondary">
            Déchiffrement…
          </Text>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--spacing-2)" }}>
        <Button
          label="Précédent"
          variant="ghost"
          isDisabled={rang === 0}
          onClick={() => setRang((r) => Math.max(r - 1, 0))}
        />
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {rang + 1} / {medias.length}
        </Text>
        <Button
          label="Suivant"
          variant="ghost"
          isDisabled={rang === medias.length - 1}
          onClick={() => setRang((r) => Math.min(r + 1, medias.length - 1))}
        />
      </div>
    </div>
  );
}
