import type { EncryptedFile } from "@tacita/media-pipeline";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationCollections } from "../components/media/ConversationCollections";
import { MediaMessage } from "../components/media/MediaMessage";
import { MediaPicker } from "../components/media/MediaPicker";
import { MediaViewer } from "../components/media/MediaViewer";
import { PhotoCapture } from "../components/media/PhotoCapture";
import { VoicePlayer } from "../components/media/VoicePlayer";
import { dimensionsCibles } from "../lib/transcode-video";
import {
  dureeLisible,
  liensDe,
  mediaDe,
  repartir,
  tailleLisible,
  type EvenementLu,
  type Media,
} from "../components/media/media";

vi.mock("next/navigation", () => ({
  usePathname: () => "/c/!salon",
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const FICHIER: EncryptedFile = {
  url: "mxc://tacita.test/abc",
  key: { alg: "A256CTR", ext: true, k: "cle", key_ops: ["encrypt", "decrypt"], kty: "oct" },
  iv: "iv",
  hashes: { sha256: "hash" },
  v: "v2",
} as unknown as EncryptedFile;

const VIGNETTE = { ...FICHIER, url: "mxc://tacita.test/vignette" };

/** Un événement réduit à ce que le shard en lit — la forme structurelle de `EvenementLu`. */
function evenement(contenu: Record<string, unknown>, id = "$e"): EvenementLu {
  return { getId: () => id, getContent: () => contenu };
}

const image = (id = "$img") =>
  evenement(
    {
      msgtype: "m.image",
      body: "plage.jpg",
      file: FICHIER,
      info: { size: 2048, thumbnail_file: VIGNETTE },
    },
    id,
  );

/** Le pipeline est mocké à son interface (spec 11) : aucun octet n'est déchiffré ici. */
const telecharger = vi.fn(async () => new Blob(["binaire"], { type: "image/jpeg" }));

beforeEach(() => {
  // jsdom n'implémente ni l'un ni l'autre : ce sont des lacunes d'environnement, pas
  // des dépendances du composant.
  globalThis.URL.createObjectURL ??= vi.fn(() => "blob:tacita/1");
  globalThis.URL.revokeObjectURL ??= vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("REQ-UI-14 — pièces jointes : vignettes déchiffrées, tuiles, vocaux", () => {
  it("la vignette est rendue depuis le blob déchiffré, et aucune URL serveur n'est construite", async () => {
    const reseau = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("réseau interdit"));

    render(<MediaMessage media={mediaDe(image())!} telecharger={telecharger} />);
    await waitFor(() => expect(screen.getByAltText("plage.jpg")).toBeTruthy());

    // Le blob vient de `downloadAttachment` (mocké), et rien d'autre n'a été demandé au
    // réseau : surtout pas l'endpoint `thumbnail`, inopérant sur média chiffré.
    expect(telecharger).toHaveBeenCalledWith(VIGNETTE, "image/jpeg");
    expect(reseau).not.toHaveBeenCalled();
    expect(screen.getByAltText("plage.jpg").getAttribute("src")).toMatch(/^blob:/);
  });

  it("en attente du déchiffrement, un skeleton — pas un trou qui déplace la timeline", () => {
    // Une promesse qui ne se résout jamais : le déchiffrement est « en cours », et c'est
    // exactement l'état que le skeleton doit rendre.
    render(<MediaMessage media={mediaDe(image())!} telecharger={() => new Promise<Blob>(() => {})} />);
    expect(screen.queryByAltText("plage.jpg")).toBeNull();
  });

  /**
   * La tuile n'est **pas** un `Button` d'Astryx.
   *
   * Celui-ci est un contrôle de formulaire à hauteur fixe — `--size-element-md`, 32 px —
   * avec son rembourrage horizontal, et la vignette de 240 px y était passée en enfant.
   * L'image débordait d'un cadre huit fois trop court, se posait par-dessus les messages
   * voisins, et l'alignement de la colonne partait avec elle : c'était le défaut visible
   * de l'envoi de photo.
   *
   * Ce que le test tient, c'est la **boîte**. jsdom ne calcule aucune géométrie, mais il
   * lit les styles déclarés, et ce sont eux qui étaient absents : une hauteur déclarée sur
   * la tuile est ce qui manquait pour que la photo cesse de déborder.
   */
  it("la tuile réserve la boîte de la vignette, au ratio de l'original", async () => {
    const portrait = mediaDe(
      evenement({
        msgtype: "m.image",
        body: "plage.jpg",
        file: FICHIER,
        info: { size: 2048, thumbnail_file: VIGNETTE, w: 1200, h: 1600 },
      }),
    )!;
    expect(portrait.largeur).toBe(1200);
    expect(portrait.hauteur).toBe(1600);

    // 240 × 1600 / 1200 = 320, qui est aussi le plafond : une photo en mode portrait ne
    // prend pas toute la hauteur de l'écran.
    const { container, unmount } = render(
      <MediaMessage media={portrait} telecharger={() => new Promise<Blob>(() => {})} />,
    );
    // StyleX passe ses valeurs dynamiques par des variables CSS en attribut `style` :
    // c'est l'attribut brut qu'on lit, `element.style.height` y est vide.
    expect(container.firstElementChild?.getAttribute("style")).toContain("320px");
    unmount();

    render(<MediaMessage media={portrait} telecharger={telecharger} />);
    await waitFor(() => expect(screen.getByAltText("plage.jpg")).toBeTruthy());

    // La même boîte une fois l'image arrivée : c'est ce partage qui fait que la timeline
    // ne saute pas au déchiffrement (DESIGN.md, « Skeleton de même géométrie »).
    const tuile = screen.getByRole("button", { name: "Image plage.jpg" });
    expect(tuile.style.width).toBe("240px");
    expect(tuile.style.height).toBe("320px");
    expect(tuile.style.overflow).toBe("hidden");
    // Et aucune hauteur de contrôle de formulaire n'est imposée à la photo.
    expect(tuile.style.padding).toBe("0px");
  });

  it("un média indéchiffrable le dit, sans repli inventé", async () => {
    render(
      <MediaMessage
        media={mediaDe(image())!}
        telecharger={vi.fn(async () => {
          throw new Error("hash refusé");
        })}
      />,
    );
    await waitFor(() => expect(screen.getByText(/n'a pas pu être déchiffré/)).toBeTruthy());
  });

  /**
   * **Le déchiffrement suit le blob, pas l'objet qui le décrit.**
   *
   * `mediaDe()` reconstruit un `Media` à chaque appel, et ses appelants l'appellent à
   * chaque rendu — le mémo de `Conversation` se recalcule à chaque tour de `/sync`, la
   * galerie appelle `mediaDe` dans son rendu. Tant que l'effet dépendait de l'objet, un
   * simple accusé de lecture relançait le téléchargement et le déchiffrement de chaque
   * vignette de la timeline.
   */
  it("un rendu de plus sur un média équivalent ne re-déchiffre rien", async () => {
    const { rerender } = render(<MediaMessage media={mediaDe(image())!} telecharger={telecharger} />);
    await waitFor(() => expect(screen.getByAltText("plage.jpg")).toBeTruthy());
    expect(telecharger).toHaveBeenCalledTimes(1);

    // Le même événement, relu : même contenu, même URL `mxc://`, objet différent.
    rerender(<MediaMessage media={mediaDe(image())!} telecharger={telecharger} />);
    rerender(<MediaMessage media={mediaDe(image())!} telecharger={telecharger} />);
    expect(telecharger).toHaveBeenCalledTimes(1);

    // Un autre blob, lui, se déchiffre : la mémoïsation ne fige pas le composant.
    const autre = mediaDe(
      evenement({
        msgtype: "m.image",
        body: "montagne.jpg",
        file: FICHIER,
        info: { thumbnail_file: { ...VIGNETTE, url: "mxc://tacita.test/vignette-2" } },
      }),
    )!;
    rerender(<MediaMessage media={autre} telecharger={telecharger} />);
    await waitFor(() => expect(telecharger).toHaveBeenCalledTimes(2));
  });

  /**
   * REQ-MED-05 — un fichier qui n'est ni photo ni vidéo n'ouvre aucun viewer : sans ce
   * bouton, ses octets étaient déchiffrables et pourtant inatteignables. Signalé tel quel
   * par les utilisateurs.
   */
  it("un fichier porte une sortie : le téléchargement sur l'appareil", () => {
    const fichier = mediaDe(
      evenement({ msgtype: "m.file", body: "contrat.pdf", file: FICHIER, info: { size: 1536 } }),
    )!;
    const onSauvegarder = vi.fn();
    render(<MediaMessage media={fichier} telecharger={telecharger} onSauvegarder={onSauvegarder} />);

    fireEvent.click(screen.getByRole("button", { name: "Télécharger" }));
    expect(onSauvegarder).toHaveBeenCalledTimes(1);
    // Le clic ne déchiffre pas ici : c'est le câblage qui possède le pipeline (M-E).
    expect(telecharger).not.toHaveBeenCalled();
  });

  it("un fichier rend son nom et sa taille, jamais une vignette", () => {
    const fichier = mediaDe(
      evenement({ msgtype: "m.file", body: "contrat.pdf", file: FICHIER, info: { size: 1536 } }),
    )!;
    render(<MediaMessage media={fichier} telecharger={telecharger} />);

    expect(screen.getByText("contrat.pdf")).toBeTruthy();
    expect(screen.getByText(tailleLisible(1536))).toBeTruthy();
    expect(telecharger).not.toHaveBeenCalled();
  });

  it("le vocal rend sa forme d'onde et sa durée", () => {
    render(<VoicePlayer dureeMs={9000} ondes={[0, 512, 1024, 256]} />);
    expect(screen.getByText(dureeLisible(9000))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lire le message vocal" })).toBeTruthy();
  });

  it("les tailles se lisent en unités binaires, comme dans l'OS", () => {
    expect(tailleLisible(512)).toBe("512 o");
    expect(tailleLisible(1536)).toBe("1.5 Ko");
    expect(tailleLisible(5 * 1024 * 1024)).toBe("5.0 Mo");
  });

  it("là où le navigateur n'encode pas la vidéo, elle n'est pas proposée — et le dit si elle passe", () => {
    const onFichiers = vi.fn();
    render(<MediaPicker onFichiers={onFichiers} />);

    const champ = screen.getByLabelText("Joindre des fichiers") as HTMLInputElement;
    expect(champ.getAttribute("accept")).not.toContain("video/");

    const video = new File(["x"], "clip.mp4", { type: "video/mp4" });
    const photo = new File(["y"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(champ, { target: { files: [video, photo] } });

    // La photo part, la vidéo est refusée avec une phrase — pas en silence.
    expect(onFichiers).toHaveBeenCalledWith([photo]);
    expect(screen.getByText(/ne sait pas encoder de vidéo/)).toBeTruthy();
  });

  it("là où il l'encode, la vidéo passe comme le reste", () => {
    const onFichiers = vi.fn();
    render(<MediaPicker onFichiers={onFichiers} videoAutorisee />);

    const champ = screen.getByLabelText("Joindre des fichiers") as HTMLInputElement;
    expect(champ.getAttribute("accept")).toContain("video/*");

    const video = new File(["x"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(champ, { target: { files: [video] } });

    expect(onFichiers).toHaveBeenCalledWith([video]);
    expect(screen.queryByText(/ne sait pas encoder/)).toBeNull();
  });

  it("les dimensions cibles réduisent sans agrandir, et restent paires", () => {
    // H.264 encode par macroblocs : une dimension impaire est refusée par l'encodeur.
    expect(dimensionsCibles(1920, 1080, 720)).toEqual({ largeur: 1280, hauteur: 720 });
    expect(dimensionsCibles(1080, 1920, 720)).toEqual({ largeur: 406, hauteur: 720 });
    // Déjà plus petite que la cible : on ne remonte pas une vidéo, on la laisse.
    expect(dimensionsCibles(640, 480, 720)).toEqual({ largeur: 640, hauteur: 480 });
  });

  it("pendant l'envoi, un état et une annulation — pas une barre inventée", () => {
    const onAnnuler = vi.fn();
    render(<MediaPicker onFichiers={vi.fn()} enCours onAnnuler={onAnnuler} />);

    expect(screen.getByText("Envoi en cours…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Annuler l'envoi" }));
    expect(onAnnuler).toHaveBeenCalledTimes(1);
  });
});

describe("REQ-UI-15 — capture : « sur votre appareil » et « envoyé » ne se confondent pas", () => {
  const flux = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;

  beforeEach(() => {
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => flux) },
    });
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as never;
    HTMLCanvasElement.prototype.toBlob = function toBlob(rappel: BlobCallback) {
      rappel(new Blob(["photo"], { type: "image/jpeg" }));
    };
  });

  const prendre = async () => {
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Prendre la photo" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prendre la photo" }));
    await waitFor(() => expect(screen.getByAltText("Photo prise")).toBeTruthy());
  };

  it("les deux libellés sont distincts et explicites", async () => {
    render(<PhotoCapture ouvert onFermer={vi.fn()} onEnregistrer={vi.fn()} onEnvoyer={vi.fn()} />);
    await prendre();

    // REQ-MED-05 : l'original reste sur l'appareil, le correspondant reçoit une version
    // compressée. Les deux libellés le disent, chacun le sien.
    expect(screen.getByRole("button", { name: /Enregistrer sur votre appareil \(original\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Envoyer \(version compressée\)/ })).toBeTruthy();
  });

  it("enregistrer ne déclenche pas l'envoi, et inversement", async () => {
    const onEnregistrer = vi.fn();
    const onEnvoyer = vi.fn();
    render(
      <PhotoCapture ouvert onFermer={vi.fn()} onEnregistrer={onEnregistrer} onEnvoyer={onEnvoyer} />,
    );
    await prendre();

    fireEvent.click(screen.getByRole("button", { name: /Enregistrer sur votre appareil/ }));
    expect(onEnregistrer).toHaveBeenCalledTimes(1);
    expect(onEnvoyer).not.toHaveBeenCalled();
  });

  /**
   * La prise ne survit pas à la fermeture.
   *
   * `<dialog>` garde son contenu dans le DOM même fermé, et rien ne remettait `prise` à
   * zéro : la feuille rouverte affichait la photo précédente à la place de la caméra. Une
   * photo au premier plan d'un écran censé en prendre une nouvelle, dont le seul moyen de
   * sortir était de recharger la page.
   */
  it("une feuille rouverte montre la caméra, jamais la photo d'avant", async () => {
    const { rerender } = render(
      <PhotoCapture ouvert onFermer={vi.fn()} onEnregistrer={vi.fn()} onEnvoyer={vi.fn()} />,
    );
    await prendre();

    rerender(
      <PhotoCapture
        ouvert={false}
        onFermer={vi.fn()}
        onEnregistrer={vi.fn()}
        onEnvoyer={vi.fn()}
      />,
    );
    rerender(<PhotoCapture ouvert onFermer={vi.fn()} onEnregistrer={vi.fn()} onEnvoyer={vi.fn()} />);

    expect(screen.queryByAltText("Photo prise")).toBeNull();
    await waitFor(() => expect(screen.getByLabelText("Aperçu de la caméra")).toBeTruthy());
  });

  it("la même prise part sous le même nom qu'elle est enregistrée", async () => {
    const onEnregistrer = vi.fn();
    const onEnvoyer = vi.fn();
    render(
      <PhotoCapture ouvert onFermer={vi.fn()} onEnregistrer={onEnregistrer} onEnvoyer={onEnvoyer} />,
    );
    await prendre();

    fireEvent.click(screen.getByRole("button", { name: /Enregistrer sur votre appareil/ }));
    fireEvent.click(screen.getByRole("button", { name: /Envoyer \(version compressée\)/ }));

    // Le nom était recalculé à chaque rendu depuis l'horloge : une seconde entre les deux
    // clics suffisait à donner deux noms à une seule photo.
    expect(onEnregistrer.mock.calls[0]![1]).toBe(onEnvoyer.mock.calls[0]![0].name);
  });

  it("sans API caméra, la feuille le dit — et ne renvoie pas vers un réglage inexistant", async () => {
    // Hors contexte sécurisé, `mediaDevices` est absent. L'optionnel court-circuitait
    // toute la chaîne : ni flux, ni erreur, un bouton désactivé et pas un mot.
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    render(<PhotoCapture ouvert onFermer={vi.fn()} onEnregistrer={vi.fn()} onEnvoyer={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/ne donne pas accès à la caméra/)).toBeTruthy());
    // Deux causes, deux phrases : celle-ci ne se rattrape pas dans les réglages.
    expect(screen.queryByText(/réglages de votre navigateur/)).toBeNull();
  });

  it("un refus de caméra s'explique et se rattrape", async () => {
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => Promise.reject(new Error("refus"))) },
    });

    render(<PhotoCapture ouvert onFermer={vi.fn()} onEnregistrer={vi.fn()} onEnvoyer={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/accès à la caméra a été refusé/)).toBeTruthy());
    expect(screen.getByText(/réglages de votre navigateur/)).toBeTruthy();
  });
});

describe("REQ-UIX-16 — viewer plein écran : navigation, sauvegarde, fermeture", () => {
  const medias: Media[] = [
    mediaDe(image("$a"))!,
    { ...mediaDe(image("$b"))!, nom: "montagne.jpg" },
  ];

  const rendre = (props: Partial<Parameters<typeof MediaViewer>[0]> = {}) => {
    const actions = {
      medias,
      depart: 0,
      telecharger,
      onFermer: vi.fn(),
      onSauvegarder: vi.fn(),
      ...props,
    };
    render(<MediaViewer {...actions} />);
    return actions;
  };

  it("`Escape` ferme, comme toute modale — le geste n'est pas le seul chemin", () => {
    // Une modale plein écran qu'aucune touche ne referme est un piège au clavier.
    // Mesuré au navigateur le 08/08/2026 : le viewer ne se fermait qu'au glissement
    // vers le bas et au bouton — `Escape` ne faisait rien.
    const { onFermer } = rendre();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onFermer).toHaveBeenCalled();
  });

  it("navigue entre les médias du salon", async () => {
    rendre();
    expect(screen.getByText("1 / 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeTruthy());
  });

  it("le média entier n'est déchiffré qu'ici, pas dans la timeline", async () => {
    rendre();
    await waitFor(() => expect(telecharger).toHaveBeenCalledWith(medias[0]!.fichier, undefined));
  });

  it("sauvegarde le média affiché", () => {
    const { onSauvegarder } = rendre();
    fireEvent.click(screen.getByRole("button", { name: "Sauvegarder" }));
    expect(onSauvegarder).toHaveBeenCalledWith(medias[0]);
  });

  /**
   * **Les commandes du viewer n'étaient pas absentes : elles étaient invisibles.**
   *
   * Le fond venait de `--color-background-inverted` d'Astryx, qui vaut exactement `text` —
   * la couleur d'encre que ses boutons ghost posent dessus. « Fermer » répondait au clic
   * et ne se voyait pas ; les retours d'usage disaient « on ne peut pas fermer une photo ».
   *
   * jsdom ne calcule aucune couleur : ce test lit la **déclaration**, pas le rendu. Il ne
   * prouve pas le contraste (c'est `theme.test.ts` qui tient la paire de DESIGN.md) ; il
   * empêche la ligne qui le porte de disparaître sans que personne ne le voie.
   */
  it("le viewer pose son fond et son encre, au lieu d'hériter de ceux du thème", () => {
    rendre();
    const style = screen.getByRole("dialog").getAttribute("style") ?? "";

    expect(style).toContain("var(--tacita-viewer)");
    // Le fond inversé d'Astryx suit le thème *et* vaut l'encre : les deux raisons pour
    // lesquelles il n'a rien à faire ici.
    expect(style).not.toContain("--color-background-inverted");
    // L'encre est remappée dans la portée du viewer, ce qui couvre tous ses enfants
    // Astryx — y compris ceux qu'on y ajoutera.
    for (const token of ["--color-text-primary", "--color-icon-primary", "--color-text-disabled"]) {
      expect(style, token).toContain(`${token}: var(--tacita-sur-viewer`);
    }
  });

  /**
   * Le pendant de « un rendu de plus ne re-déchiffre rien » (REQ-UI-14), là où il coûtait
   * le plus cher : `Conversation` reconstruit ses `Media` à chaque tour de `/sync`, et la
   * vidéo ouverte était re-téléchargée et re-déchiffrée **pendant sa lecture**, qui
   * repartait de zéro à chaque fois. C'est le « on déchiffre 2 secondes par 2 secondes »
   * des retours d'usage.
   */
  it("un rafraîchissement de la conversation ne re-déchiffre pas le média ouvert", async () => {
    const { rerender } = render(
      <MediaViewer
        medias={medias}
        depart={0}
        telecharger={telecharger}
        onFermer={vi.fn()}
        onSauvegarder={vi.fn()}
      />,
    );
    await waitFor(() => expect(telecharger).toHaveBeenCalledTimes(1));

    // Les mêmes médias, relus de leurs événements : même contenu, autres objets.
    rerender(
      <MediaViewer
        medias={[mediaDe(image("$a"))!, { ...mediaDe(image("$b"))!, nom: "montagne.jpg" }]}
        depart={0}
        telecharger={telecharger}
        onFermer={vi.fn()}
        onSauvegarder={vi.fn()}
      />,
    );
    expect(telecharger).toHaveBeenCalledTimes(1);
  });

  /**
   * Un blob `application/octet-stream` ne dit pas au lecteur quel conteneur il ouvre :
   * `downloadAttachment` rend des octets nus, et le type du blob est le seul indice qui
   * reste. Le pipeline écrit `info.mimetype` — il suffisait de le lire.
   */
  it("le blob de la vidéo part avec le type déclaré dans l'événement", async () => {
    const video = mediaDe(
      evenement({
        msgtype: "m.video",
        body: "sortie.mp4",
        file: FICHIER,
        info: { mimetype: "video/mp4", thumbnail_file: VIGNETTE, duration: 4000 },
      }),
    )!;
    expect(video.mime).toBe("video/mp4");

    render(
      <MediaViewer
        medias={[video]}
        depart={0}
        telecharger={telecharger}
        onFermer={vi.fn()}
        onSauvegarder={vi.fn()}
      />,
    );
    await waitFor(() => expect(telecharger).toHaveBeenCalledWith(video.fichier, "video/mp4"));
  });

  it("un glissement vers le bas ferme", () => {
    const { onFermer } = rendre();
    const vue = screen.getByRole("dialog");
    fireEvent(vue, new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
    fireEvent(vue, new MouseEvent("pointerup", { bubbles: true, clientX: 100, clientY: 300 }));
    expect(onFermer).toHaveBeenCalledTimes(1);
  });
});

describe("REQ-UIX-17 / REQ-UIX-18 — galeries partagées : quatre onglets, périmètre honnête", () => {
  const evenements: EvenementLu[] = [
    image("$img"),
    evenement({ msgtype: "m.file", body: "contrat.pdf", file: FICHIER, info: { size: 10 } }, "$fic"),
    evenement({ msgtype: "m.audio", body: "vocal.ogg", file: FICHIER, info: { duration: 3000 } }, "$voc"),
    evenement({ msgtype: "m.text", body: "regarde https://tacita.test/doc" }, "$lien"),
    evenement({ msgtype: "m.text", body: "juste du texte" }, "$txt"),
  ];

  it("répartit un jeu d'événements mixtes dans les quatre onglets", () => {
    const reparti = repartir(evenements, ["$txt"]);

    expect(reparti.medias.map((e) => e.getId())).toEqual(["$img"]);
    // Un vocal est un fichier : il n'a pas de vignette et n'a rien à faire dans une grille.
    expect(reparti.fichiers.map((e) => e.getId())).toEqual(["$fic", "$voc"]);
    expect(reparti.liens.map((e) => e.getId())).toEqual(["$lien"]);
    expect(reparti.epingles.map((e) => e.getId())).toEqual(["$txt"]);
  });

  it("une URL dans un texte va dans Liens ; une phrase sans URL n'y va pas", () => {
    expect(liensDe(evenements[3]!)).toEqual(["https://tacita.test/doc"]);
    expect(liensDe(evenements[4]!)).toEqual([]);
    // `www.` n'est pas deviné : un faux positif transformerait une phrase en lien.
    expect(liensDe(evenement({ msgtype: "m.text", body: "va sur www.tacita.test" }))).toEqual([]);
  });

  it("le périmètre est affiché, pas sous-entendu", () => {
    render(
      <ConversationCollections evenements={evenements} epingles={[]} telecharger={telecharger} />,
    );
    expect(screen.getByText(/historique téléchargé sur cet appareil/)).toBeTruthy();
  });

  it("l'onglet Épinglés porte la mention de non-chiffrement (REQ-UIX-18)", () => {
    render(
      <ConversationCollections evenements={evenements} epingles={["$txt"]} telecharger={telecharger} />,
    );
    fireEvent.click(screen.getByText("Épinglés"));
    expect(screen.getByText(/n'est pas chiffrée : le serveur la voit/)).toBeTruthy();
  });

  it("un onglet vide rend un Placeholder, jamais un écran nu", () => {
    render(<ConversationCollections evenements={[]} epingles={[]} telecharger={telecharger} />);
    expect(screen.getByText(/Aucune photo ni vidéo/)).toBeTruthy();
  });

  /**
   * REQ-UIX-17 — la planche contact : trois carrés par ligne, comme Instagram.
   *
   * Les médias sortaient en **liste verticale de tuiles au ratio de leur original** — la
   * géométrie de la timeline, où une photo est un message et garde le cadrage de son
   * auteur. Dans une galerie elle devient une planche contact, et trois cadrages
   * différents par ligne donnent une grille en dents de scie qu'on ne balaie plus.
   *
   * jsdom ne calcule aucune grille ; ce sont les styles **déclarés** qu'on lit, et c'est
   * bien eux qui manquaient.
   */
  it("les médias se pavent en trois carrés par ligne ; le texte reste en liste", async () => {
    const { container } = render(
      <ConversationCollections evenements={evenements} epingles={["$txt"]} telecharger={telecharger} />,
    );

    const grille = container.querySelector("ul") as HTMLElement;
    expect(grille.style.gridTemplateColumns).toBe("repeat(3, 1fr)");

    // La cellule commande, et elle est carrée : ni largeur de 240 px, ni ratio d'origine.
    await waitFor(() => expect(screen.getByAltText("plage.jpg")).toBeTruthy());
    const tuile = screen.getByRole("button", { name: "Image plage.jpg" });
    expect(tuile.style.aspectRatio).toBe("1 / 1");
    expect(tuile.style.width).toBe("100%");
    expect(tuile.style.overflow).toBe("hidden");
    // Le pavage fait la planche contact : douze coins ronds par écran la dissolvent.
    expect(tuile.style.borderRadius).toBe("0");

    // Les onglets de texte gardent la liste : une ligne de lien n'est pas une vignette.
    fireEvent.click(screen.getByText("Épinglés"));
    expect((container.querySelector("ul") as HTMLElement).style.gridTemplateColumns).toBe("");
  });

  it("les quatre onglets sont ceux du wireframe, dans l'ordre", () => {
    render(<ConversationCollections evenements={[]} epingles={[]} telecharger={telecharger} />);
    const section = within(screen.getByLabelText("Contenus partagés"));
    for (const libelle of ["Médias", "Épinglés", "Liens", "Fichiers"]) {
      expect(section.getByText(libelle)).toBeTruthy();
    }
  });
});
