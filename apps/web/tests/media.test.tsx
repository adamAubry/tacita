import type { EncryptedFile } from "@tacita/media-pipeline";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationCollections } from "../components/media/ConversationCollections";
import { MediaMessage } from "../components/media/MediaMessage";
import { MediaPicker } from "../components/media/MediaPicker";
import { MediaViewer } from "../components/media/MediaViewer";
import { PhotoCapture } from "../components/media/PhotoCapture";
import { VoicePlayer } from "../components/media/VoicePlayer";
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

  it("le sélecteur n'accepte pas la vidéo, faute de transcodage — et le dit", () => {
    const onFichiers = vi.fn();
    render(<MediaPicker onFichiers={onFichiers} />);

    const champ = screen.getByLabelText("Joindre des fichiers") as HTMLInputElement;
    expect(champ.getAttribute("accept")).not.toContain("video/");

    const video = new File(["x"], "clip.mp4", { type: "video/mp4" });
    const photo = new File(["y"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(champ, { target: { files: [video, photo] } });

    // La photo part, la vidéo est refusée avec une phrase — pas en silence.
    expect(onFichiers).toHaveBeenCalledWith([photo]);
    expect(screen.getByText(/vidéos n'est pas encore disponible/)).toBeTruthy();
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

  it("navigue entre les médias du salon", async () => {
    rendre();
    expect(screen.getByText("1 / 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeTruthy());
  });

  it("le média entier n'est déchiffré qu'ici, pas dans la timeline", async () => {
    rendre();
    await waitFor(() => expect(telecharger).toHaveBeenCalledWith(medias[0]!.fichier));
  });

  it("sauvegarde le média affiché", () => {
    const { onSauvegarder } = rendre();
    fireEvent.click(screen.getByRole("button", { name: "Sauvegarder" }));
    expect(onSauvegarder).toHaveBeenCalledWith(medias[0]);
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

  it("les quatre onglets sont ceux du wireframe, dans l'ordre", () => {
    render(<ConversationCollections evenements={[]} epingles={[]} telecharger={telecharger} />);
    const section = within(screen.getByLabelText("Contenus partagés"));
    for (const libelle of ["Médias", "Épinglés", "Liens", "Fichiers"]) {
      expect(section.getByText(libelle)).toBeTruthy();
    }
  });
});
