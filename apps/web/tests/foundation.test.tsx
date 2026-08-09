import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ButtonsList } from "../components/foundation/ButtonsList";
import { ConnectionBanner, ConnectionBannerLive } from "../components/foundation/ConnectionBanner";
import { LayoutHeader } from "../components/foundation/LayoutHeader";
import { Navbar, ONGLETS } from "../components/foundation/Navbar";
import { Placeholder } from "../components/foundation/Placeholder";
import { Sheet } from "../components/foundation/Sheet";
import { SegmentedControl, SegmentedControlItem, Skeleton } from "../components/foundation/primitives";
import { RACINE, sansCommentaires, sourcesLivrees } from "./sources";

/**
 * `next/navigation` n'existe pas hors du rendu de Next. Les deux fonctions dont les
 * composants dépendent sont remplacées ; c'est le comportement du composant qu'on
 * teste, pas le routeur.
 */
const chemin = vi.fn(() => "/");
const retour = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => chemin(),
  useRouter: () => ({ back: retour, push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("REQ-UIX-01 — navbar : quatre onglets, actif surélevé, sans rechargement", () => {
  it("rend les quatre onglets du wireframe, dans l'ordre", () => {
    render(<Navbar />);
    expect(ONGLETS.map((o) => o.libelle)).toEqual(["Accueil", "Recherche", "Mentions", "Profil"]);
    for (const { libelle } of ONGLETS) expect(screen.getByLabelText(libelle)).toBeTruthy();
  });

  it("l'onglet actif porte l'accent et la surélévation, les autres non", () => {
    chemin.mockReturnValue("/recherche");
    render(<Navbar />);

    const actif = screen.getByLabelText("Recherche");
    expect(actif.getAttribute("aria-current")).toBe("page");
    expect(actif.style.transform).toBe("translateY(-1px)");
    expect(actif.style.color).toContain("--color-icon-accent");

    const inactif = screen.getByLabelText("Accueil");
    expect(inactif.getAttribute("aria-current")).toBeNull();
    expect(inactif.style.transform).toBe("");
  });

  it("l'accueil ne s'allume que sur lui-même", () => {
    // `startsWith("/")` allumerait les quatre onglets partout : tout chemin commence
    // par une barre oblique.
    chemin.mockReturnValue("/mentions");
    render(<Navbar />);
    expect(screen.getByLabelText("Accueil").getAttribute("aria-current")).toBeNull();
    expect(screen.getByLabelText("Mentions").getAttribute("aria-current")).toBe("page");
  });

  it("navigue par lien, sans rechargement, avec des cibles de 44 px", () => {
    render(<Navbar />);
    for (const { libelle, href } of ONGLETS) {
      const lien = screen.getByLabelText(libelle);
      // Un `<a href>` rendu par next/link : la navigation est client, pas un POST ni un
      // rechargement complet.
      expect(lien.tagName).toBe("A");
      expect(lien.getAttribute("href")).toBe(href);
      expect(lien.style.minHeight).toBe("44px");
      expect(lien.style.minWidth).toBe("44px");
    }
  });
});

describe("REQ-UIX-02 — header : titre centré, retour par l'historique", () => {
  it("affiche le titre et rend le bouton de retour", () => {
    render(<LayoutHeader titre="Réglages" />);
    expect(screen.getAllByText("Réglages").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Retour")).toBeTruthy();
  });

  it("le retour suit l'historique, jamais une route codée en dur", () => {
    render(<LayoutHeader titre="Conversation" />);
    fireEvent.click(screen.getByLabelText("Retour"));
    expect(retour).toHaveBeenCalledTimes(1);
  });

  it("les layouts sans pile n'ont pas de retour", () => {
    render(<LayoutHeader titre="Accueil" retour={false} />);
    expect(screen.queryByLabelText("Retour")).toBeNull();
  });
});

describe("REQ-UIX-03 — Placeholder : pourquoi c'est vide, et quoi faire", () => {
  it("rend l'icône, le texte et l'action", () => {
    render(
      <Placeholder
        titre="Aucune conversation"
        explication="Commencez par ajouter quelqu'un."
        icone={<svg data-testid="icone" />}
        action={<button type="button">Ajouter</button>}
      />,
    );

    expect(screen.getByText("Aucune conversation")).toBeTruthy();
    expect(screen.getByText("Commencez par ajouter quelqu'un.")).toBeTruthy();
    expect(screen.getByTestId("icone")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeTruthy();
  });

  it("un état vide sans issue n'invente pas d'action", () => {
    render(<Placeholder titre="Aucune mention" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("REQ-UIX-04 — skeletons et bandeau d'état de connexion", () => {
  it("le squelette rend une géométrie, pas un spinner", () => {
    // DESIGN.md : « pas de spinner plein écran : skeletons localisés », de même
    // géométrie que le contenu final pour qu'il n'y ait aucun décalage à l'arrivée.
    const { container } = render(<Skeleton width={200} height={44} />);
    expect(container.firstElementChild).toBeTruthy();
  });

  it("en ligne, le bandeau n'existe pas", () => {
    // Un bandeau permanent qui dit « tout va bien » est du bruit : on cesse de le lire
    // au moment où il aurait quelque chose à dire.
    const { container } = render(<ConnectionBanner etat="en-ligne" />);
    expect(container.innerHTML).toBe("");
  });

  it("hors ligne, il tient une promesse plutôt que d'annoncer une panne", () => {
    render(<ConnectionBanner etat="hors-ligne" />);
    expect(screen.getByText("Hors ligne")).toBeTruthy();
    // REQ-UI-17 : l'historique reste lisible et l'envoi est différé, pas perdu.
    expect(screen.getByText(/consultables/)).toBeTruthy();
    expect(screen.getByText(/à la reconnexion/)).toBeTruthy();
  });
});

describe("REQ-UIX-05 — primitives partagées", () => {
  it("le sélecteur de composant rend ses options et remonte le choix", () => {
    const choisir = vi.fn();
    render(
      <SegmentedControl label="Vue" value="messages" onChange={choisir}>
        <SegmentedControlItem value="messages" label="Messages" />
        <SegmentedControlItem value="medias" label="Médias" />
      </SegmentedControl>,
    );

    fireEvent.click(screen.getByText("Médias"));
    expect(choisir).toHaveBeenCalledWith("medias");
  });

  it("la liste de boutons rend les actions et les déclenche", () => {
    const ouvrir = vi.fn();
    render(
      <ButtonsList
        boutons={[
          { cle: "a", libelle: "Ouvrir", onClick: ouvrir },
          { cle: "b", libelle: "Quitter le groupe", onClick: vi.fn(), destructif: true },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Ouvrir"));
    expect(ouvrir).toHaveBeenCalledTimes(1);
    // DESIGN.md : `danger` est réservé au destructif — et il est porté par le token.
    expect(screen.getByText("Quitter le groupe").closest("[style]")?.getAttribute("style")).toContain(
      "--color-error",
    );
  });

  it("la feuille s'ouvre et se ferme par son état, pas par un montage conditionnel", () => {
    // `<dialog>` garde son contenu dans le DOM et le masque : c'est le comportement
    // natif, et c'est lui qui permet à la plateforme d'animer l'ouverture et de gérer
    // le piège de focus. On assère donc l'état d'ouverture, pas la présence du texte.
    const { rerender } = render(
      <Sheet ouvert={false} onFermer={vi.fn()} nom="Feuille de test">
        <p>Contenu</p>
      </Sheet>,
    );
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false);

    rerender(
      <Sheet ouvert onFermer={vi.fn()} nom="Feuille de test">
        <p>Contenu</p>
      </Sheet>,
    );
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    expect(screen.getByText("Contenu")).toBeTruthy();
  });

  /**
   * WCAG 4.1.2 — audit impeccable du 07/08/2026. Neuf feuilles s'ouvraient sans nom
   * accessible : un lecteur d'écran annonçait « boîte de dialogue » et s'arrêtait là.
   * Astryx l'écrivait dans la sortie de nos propres tests, et personne ne la lisait.
   *
   * Structurel plutôt que par écran : c'est un oubli qui se refait au prochain `<Sheet>`,
   * et une feuille d'action n'a pas d'en-tête visible pour le rappeler.
   */
  it("aucune feuille ne s'ouvre sans nom accessible", () => {
    const fautives = sourcesLivrees()
      .filter(({ code }) => /<Sheet[\s>]/.test(sansCommentaires(code)))
      .flatMap(({ chemin, code }) =>
        // `(?<!=)>` : la flèche des callbacks (`onFermer={() => …}`) porte un `>` qui
        // couperait la capture avant d'atteindre les attributs suivants.
        [...sansCommentaires(code).matchAll(/<Sheet\b([^]*?)(?<!=)>/g)]
          .filter(([, attributs]) => !/\b(titre|nom)=/.test(attributs ?? ""))
          .map(() => chemin.replace(RACINE, "")),
      );

    expect(fautives).toEqual([]);
  });
});

describe("REQ-UI-17 / REQ-UIX-04 — le bandeau de connexion est branché, pas seulement écrit", () => {
  it("il suit navigator.onLine et ses deux événements", async () => {
    // Mesuré au navigateur le 08/08/2026 : `ConnectionBanner` existait, avait ses tests,
    // et **aucun écran ne le montait**. Couper le réseau n'affichait rien. Un composant
    // que personne ne rend ne tient aucune promesse — c'est le branchement qui compte.
    const etat = { valeur: true };
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => etat.valeur);

    const { container } = render(<ConnectionBannerLive />);
    expect(container.textContent).toBe("");

    etat.valeur = false;
    await act(async () => {
      globalThis.dispatchEvent(new Event("offline"));
    });
    expect(container.textContent).toContain("Hors ligne");

    etat.valeur = true;
    await act(async () => {
      globalThis.dispatchEvent(new Event("online"));
    });
    expect(container.textContent).toBe("");
  });

  it("le shell le rend, et au-dessus de la porte de récupération", () => {
    // La porte remplace tout le contenu : un bandeau posé sous elle serait invisible
    // exactement quand il compte — perdre le réseau pendant l'onboarding.
    const providers = readFileSync(join(RACINE, "app/providers.tsx"), "utf8");
    expect(providers).toMatch(/<ConnectionBannerLive\s*\/>/);
    expect(providers.indexOf("<ConnectionBannerLive")).toBeLessThan(providers.indexOf("<RecoveryGate"));
  });
});

describe("REQ-OBX-01 / REQ-UI-17 — la file d'envoi appartient à la session, pas à un écran", () => {
  it("`createOutbox` n'est appelé que par le provider de session", () => {
    // Elle vivait dans `Conversation` : créée à l'ouverture d'un salon, `dispose()` au
    // démontage. Le bandeau hors ligne promet que « ce que vous écrivez partira à la
    // reconnexion » — c'était faux dès qu'on quittait l'écran. Mesuré au navigateur le
    // 08/08/2026 : deux messages écrits hors ligne, un rechargement, le réseau revenu,
    // et rien ne partait. Une promesse qu'on ne tient pas, c'est l'interdit n°13.
    const appelants = sourcesLivrees()
      .filter(({ code }) => /\bcreateOutbox\s*\(/.test(sansCommentaires(code)))
      .map(({ chemin }) => chemin.replace(RACINE, ""));

    expect(appelants).toEqual(["/components/conversation/OutboxProvider.tsx"]);
  });

  it("le provider enveloppe les écrans dans le shell", () => {
    const providers = readFileSync(join(RACINE, "app/providers.tsx"), "utf8");
    expect(providers).toMatch(/<OutboxProvider>/);
  });
});
