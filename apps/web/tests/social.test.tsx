import type { Profile } from "@tacita/messaging";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AjouterAmis } from "../components/amis/AjouterAmis";
import { Demandes } from "../components/amis/Demandes";
import { Note } from "../components/profil/Note";
import { ProfilAutrui, CONFIRMATIONS } from "../components/profil/ProfilAutrui";
import { ProfilMoi } from "../components/profil/ProfilMoi";
import type { Demande } from "../lib/contacts";
import { LIBELLE_NOTE, lireNote } from "../lib/notes";
import { DEBOUNCE_MS } from "../lib/recherche";

const pousser = vi.fn();
const revenir = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/profil/@mira:tacita.test",
  useRouter: () => ({ push: pousser, back: revenir }),
  useSearchParams: () => new URLSearchParams(),
}));

const MIRA: Profile = { userId: "@mira:tacita.test", displayName: "mira" };
const MOI: Profile = { userId: "@adam:tacita.test", displayName: "adam" };

/** Une base neuve par test : les notes persistent, et un test ne doit rien hériter. */
let base: IDBFactory;
beforeEach(() => {
  base = new IDBFactory();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const rendreAutrui = (props: Partial<Parameters<typeof ProfilAutrui>[0]> = {}) => {
  const actions = {
    profil: MIRA,
    estAmi: false,
    bloque: false,
    indexedDB: base,
    onMessage: vi.fn(),
    onAppel: vi.fn(),
    onInviter: vi.fn().mockResolvedValue(undefined),
    onAction: vi.fn().mockResolvedValue(undefined),
    activite: <div>galeries</div>,
    ...props,
  };
  render(<ProfilAutrui {...actions} />);
  return actions;
};

describe("REQ-UIX-25 — profil d'un ami : le sélecteur Actions / Activity", () => {
  it("un ami voit le sélecteur, jamais le bouton d'ajout", () => {
    rendreAutrui({ estAmi: true });

    expect(screen.getByRole("radiogroup", { name: "Actions ou activité" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Appel audio/ })).toBeTruthy();
    // Les deux états s'excluent : proposer « Ajouter » à un ami serait sans effet.
    expect(screen.queryByRole("button", { name: "Ajouter" })).toBeNull();
  });

  it("l'onglet Activity rend les galeries du DM partagé", () => {
    rendreAutrui({ estAmi: true, activite: <div>galeries du DM</div> });

    expect(screen.queryByText("galeries du DM")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Activity" }));
    expect(screen.getByText("galeries du DM")).toBeTruthy();
    // Le sélecteur bascule, il n'empile pas.
    expect(screen.queryByRole("button", { name: "Message" })).toBeNull();
  });

  it("les actions appellent leurs callbacks", () => {
    const { onMessage, onAppel } = rendreAutrui({ estAmi: true });

    fireEvent.click(screen.getByRole("button", { name: "Message" }));
    expect(onMessage).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /Appel audio/ }));
    expect(onAppel).toHaveBeenCalledOnce();
  });
});

describe("REQ-UIX-26 — profil d'un non-ami : Send invite, et rien d'autre", () => {
  it("un non-ami voit le bouton d'ajout, jamais le sélecteur", () => {
    rendreAutrui({ estAmi: false });

    expect(screen.getByRole("button", { name: "Ajouter" })).toBeTruthy();
    // Écrire à quelqu'un sans conversation serait une action qui échoue.
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("button", { name: "Message" })).toBeNull();
  });

  it("ajouter envoie la demande", async () => {
    const { onInviter } = rendreAutrui({ estAmi: false });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    });
    expect(onInviter).toHaveBeenCalledOnce();
  });

  it("le statut est affiché dans les deux cas, et le blocage prime", () => {
    const { unmount } = render(
      <ProfilAutrui
        profil={MIRA}
        estAmi={false}
        bloque={false}
        indexedDB={base}
        onMessage={vi.fn()}
        onAppel={vi.fn()}
        onInviter={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("Pas encore ami")).toBeTruthy();
    unmount();

    rendreAutrui({ estAmi: true, bloque: true });
    expect(screen.getByText("Bloqué")).toBeTruthy();
    expect(screen.queryByText("Ami")).toBeNull();
  });
});

describe("REQ-UIX-27 — note privée : libellé exact, persistée, relue", () => {
  it("le libellé est celui de l'exigence, mot pour mot", () => {
    render(<Note userId={MIRA.userId} indexedDB={base} />);

    // « sur cet appareil » n'est pas négociable : sans ces mots, l'utilisateur suppose
    // une synchronisation que D-09 a refusée définitivement.
    expect(LIBELLE_NOTE).toBe("Note (visible uniquement par vous, sur cet appareil)");
    expect(screen.getAllByText(LIBELLE_NOTE).length).toBeGreaterThan(0);
  });

  it("une note écrite est persistée puis relue au remontage", async () => {
    const { unmount } = render(<Note userId={MIRA.userId} indexedDB={base} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "rencontrée au festival" },
    });
    // Minuteurs réels : `fake-indexeddb` planifie ses transactions dessus, et les figer
    // ferait attendre une écriture qui n'aboutit jamais.
    await waitFor(async () =>
      expect(await lireNote(base, MIRA.userId)).toBe("rencontrée au festival"),
    );

    unmount();
    render(<Note userId={MIRA.userId} indexedDB={base} />);
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
        "rencontrée au festival",
      ),
    );
  });

  it("la note est propre à une personne — celle d'une autre ne fuit pas", async () => {
    render(<Note userId={MIRA.userId} indexedDB={base} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "note sur mira" } });
    await waitFor(async () => expect(await lireNote(base, MIRA.userId)).toBe("note sur mira"));
    cleanup();

    render(<Note userId="@sam:tacita.test" indexedDB={base} />);
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""),
    );
  });
});

describe("REQ-UIX-28 — Add-friends : lien, annuaire débouncé, aucune suggestion promise", () => {
  const rendre = (props: Partial<Parameters<typeof AjouterAmis>[0]> = {}) => {
    const actions = {
      chercher: vi.fn().mockResolvedValue([]),
      onPartagerLien: vi.fn().mockResolvedValue("copie" as const),
      onOuvrirProfil: vi.fn(),
      ...props,
    };
    render(<AjouterAmis {...actions} />);
    return actions;
  };

  it("l'écran dit qu'il n'y a aucune suggestion, et pourquoi", () => {
    rendre();
    // D-09 a refusé le graphe social : il n'existe aucune source. Un carrousel vide
    // laisserait croire à une panne.
    expect(screen.getByText("Aucune suggestion")).toBeTruthy();
    expect(screen.getByText(/ne construit pas de graphe social/)).toBeTruthy();
  });

  it("la recherche d'annuaire est débouncée : vingt frappes, un appel", async () => {
    vi.useFakeTimers();
    const { chercher } = rendre({
      chercher: vi.fn().mockResolvedValue([MIRA]),
    });

    const champ = screen.getByLabelText("Ajouter par identifiant");
    for (let rang = 1; rang <= 20; rang++) {
      fireEvent.change(champ, { target: { value: "m".repeat(rang) } });
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS - 50);
      });
    }
    expect(chercher).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(chercher).toHaveBeenCalledOnce();
    expect(chercher).toHaveBeenCalledWith("m".repeat(20));
  });

  it("un résultat mène au profil, il ne porte pas l'action d'ajout", async () => {
    vi.useFakeTimers();
    const { onOuvrirProfil } = rendre({ chercher: vi.fn().mockResolvedValue([MIRA]) });

    fireEvent.change(screen.getByLabelText("Ajouter par identifiant"), {
      target: { value: "mira" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });

    const carte = screen.getByRole("button", { name: "mira" });
    expect(within(carte.parentElement!).getByText("@mira:tacita.test")).toBeTruthy();
    // Ajouter se décide sur le profil, après l'avoir regardé.
    expect(screen.queryByRole("button", { name: "Ajouter" })).toBeNull();

    fireEvent.click(carte);
    expect(onOuvrirProfil).toHaveBeenCalledWith("@mira:tacita.test");
  });

  it("partager un lien dit ce qui s'est réellement passé", async () => {
    const { onPartagerLien } = rendre({
      onPartagerLien: vi.fn().mockResolvedValue("copie" as const),
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Partager un lien d'invitation"));
    });
    expect(onPartagerLien).toHaveBeenCalledOnce();
    expect(screen.getByText(/Lien copié/)).toBeTruthy();
  });
});

describe("REQ-UIX-29 — Friend request : accepter, refuser, état vide", () => {
  const demande: Demande = {
    roomId: "!dm:tacita.test",
    userId: "@mira:tacita.test",
    nom: "mira",
  };

  it("aucune demande rend le Placeholder dédié", () => {
    render(
      <Demandes demandes={[]} onAccepter={vi.fn()} onRefuser={vi.fn()} onOuvrir={vi.fn()} />,
    );
    expect(screen.getByText("Aucune demande")).toBeTruthy();
  });

  it("accepter appelle Contacts puis navigue vers le DM", async () => {
    const onAccepter = vi.fn().mockResolvedValue("!dm:tacita.test");
    const onOuvrir = vi.fn();
    render(
      <Demandes
        demandes={[demande]}
        onAccepter={onAccepter}
        onRefuser={vi.fn()}
        onOuvrir={onOuvrir}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accepter" }));
    });

    expect(onAccepter).toHaveBeenCalledWith("!dm:tacita.test");
    expect(onOuvrir).toHaveBeenCalledWith("!dm:tacita.test");
    // Optimiste : la ligne part au clic, sans attendre le serveur.
    expect(screen.getByText("Aucune demande")).toBeTruthy();
  });

  it("refuser fait disparaître la demande immédiatement", async () => {
    const onRefuser = vi.fn().mockResolvedValue(undefined);
    render(
      <Demandes
        demandes={[demande]}
        onAccepter={vi.fn()}
        onRefuser={onRefuser}
        onOuvrir={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refuser" }));
    });
    expect(onRefuser).toHaveBeenCalledWith("!dm:tacita.test");
    expect(screen.getByText("Aucune demande")).toBeTruthy();
  });

  it("un refus qui échoue remet la demande — c'est son état réel", async () => {
    const onRefuser = vi.fn().mockRejectedValue(new Error("réseau"));
    render(
      <Demandes
        demandes={[demande]}
        onAccepter={vi.fn()}
        onRefuser={onRefuser}
        onOuvrir={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refuser" }));
    });
    await waitFor(() => expect(screen.getByText("mira")).toBeTruthy());
  });
});

describe("REQ-UIX-30 — bloquer et retirer : la confirmation dit l'effet réel", () => {
  const ouvrirOptions = () => fireEvent.click(screen.getByRole("button", { name: "Options" }));

  it("bloquer explique ce que le blocage ne fait pas", async () => {
    const { onAction } = rendreAutrui({ estAmi: true });

    ouvrirOptions();
    fireEvent.click(screen.getByText("Bloquer"));

    const corps = screen.getByText(/Ses messages ne s'afficheront plus chez vous/);
    // Les trois limites réelles de `m.ignored_user_list` (REQ-MSG-17), pas une promesse
    // d'expulsion que le protocole ne tient pas.
    expect(corps.textContent).toContain("n'en sera pas informée");
    expect(corps.textContent).toContain("continuer à écrire");
    expect(corps.textContent).toContain("conversations de groupe");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Bloquer" }));
    });
    expect(onAction).toHaveBeenCalledWith("bloquer");
  });

  it("retirer un ami annonce la perte de l'historique local", async () => {
    const { onAction } = rendreAutrui({ estAmi: true });

    ouvrirOptions();
    fireEvent.click(screen.getByText("Retirer des amis"));
    expect(screen.getByText(/quitterez votre conversation privée/)).toBeTruthy();
    expect(screen.getByText(/historique ne vous sera plus accessible/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retirer" }));
    });
    expect(onAction).toHaveBeenCalledWith("retirer");
  });

  it("annuler ne déclenche rien", () => {
    const { onAction } = rendreAutrui({ estAmi: true });

    ouvrirOptions();
    fireEvent.click(screen.getByText("Bloquer"));
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("une personne déjà bloquée se débloque, sans confirmation alarmante", async () => {
    const { onAction } = rendreAutrui({ estAmi: true, bloque: true });

    ouvrirOptions();
    fireEvent.click(screen.getByText("Débloquer"));
    expect(screen.getByText(CONFIRMATIONS.debloquer.corps)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Débloquer" }));
    });
    expect(onAction).toHaveBeenCalledWith("debloquer");
  });

  it("un non-ami n'a rien à retirer", () => {
    rendreAutrui({ estAmi: false });
    ouvrirOptions();
    expect(screen.queryByText("Retirer des amis")).toBeNull();
    expect(screen.getByText("Bloquer")).toBeTruthy();
  });
});

describe("REQ-UIX-24 — son propre profil : nom, identifiant, et form edit", () => {
  it("le nom et l'identifiant sont tous deux affichés", () => {
    render(<ProfilMoi profil={MOI} onEnregistrer={vi.fn()} />);

    expect(screen.getByText("adam")).toBeTruthy();
    expect(screen.getByText("@adam:tacita.test")).toBeTruthy();
    // Pas de statut ami sur son propre profil : la question ne s'y pose pas.
    expect(screen.queryByText("Ami")).toBeNull();
  });

  it("enregistrer n'écrit que ce qui a changé", async () => {
    const onEnregistrer = vi.fn().mockResolvedValue(undefined);
    render(<ProfilMoi profil={MOI} onEnregistrer={onEnregistrer} />);

    fireEvent.click(screen.getByRole("button", { name: "Modifier le profil" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    });
    // Rien n'a bougé : une écriture inutile ferait un événement de profil dans tous les
    // salons partagés.
    expect(onEnregistrer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Modifier le profil" }));
    fireEvent.change(screen.getByLabelText("Nom d'affichage"), { target: { value: "adam a." } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    });
    expect(onEnregistrer).toHaveBeenCalledWith({ displayName: "adam a." });
  });
});
