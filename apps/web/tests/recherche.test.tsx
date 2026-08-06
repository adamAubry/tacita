import type { Session } from "@tacita/client-core";
import { asSession } from "@tacita/client-core/testing";
import type { Conversation } from "@tacita/messaging";
import type { SearchFilters, SearchHit, SearchStats } from "@tacita/search";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessagePreview } from "../components/recherche/MessagePreview";
import { RecentSearches, VISIBLES_SANS_DEBORDEMENT } from "../components/recherche/RecentSearches";
import { DEBOUNCE_MS, Recherche } from "../components/recherche/Recherche";
import { decouper } from "../components/recherche/HighlightedText";
import {
  CHAMP_APRES,
  CHAMP_CONVERSATION,
  CHAMP_MENTIONS,
  CHAMP_PERSONNE,
  CHAMP_TEXTE,
  CHAMP_TYPE,
  tokensMentions,
  versCriteres,
} from "../components/recherche/filtres";
import { SessionProvider } from "../components/onboarding/SessionProvider";
import { empiler, MAX_RECENTES } from "../lib/recherches-recentes";

const pousser = vi.fn();
/** REQ-UIX-33 — l'écran lit `?salon=` : le mock doit rendre des paramètres, pas rien. */
const parametres = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/recherche",
  useRouter: () => ({ push: pousser, back: vi.fn() }),
  useSearchParams: () => parametres,
}));

/**
 * `PowerSearch` est remplacé par un champ nu.
 *
 * Ce qu'on teste ici est **notre** logique — débounce, sections, filtrage, périmètre —,
 * pas le flux de saisie à tokens d'Astryx : le piloter demanderait de reproduire son
 * parcours interne (choisir un champ, un opérateur, valider), ce qui testerait Astryx
 * plutôt que M-F, et cassera au premier changement de sa part.
 *
 * Limite assumée : le câblage réel de la barre — sa config de champs, son `onChange` —
 * n'est donc pas couvert par ce fichier. Il l'est en partie par les tests de
 * `versCriteres`, qui portent la traduction des tokens en critères d'index, et le reste
 * demande un vrai navigateur.
 */
vi.mock("../components/foundation/primitives", async (original) => {
  const vrai = await original<typeof import("../components/foundation/primitives")>();
  const { tokenTexte } = await import("../components/recherche/filtres");

  return {
    ...vrai,
    PowerSearch: ({
      label,
      filters,
      onChange,
    }: {
      label?: string;
      filters: readonly { field: string }[];
      onChange: (filtres: readonly unknown[], type: string, index: number) => void;
    }) => (
      <input
        role="combobox"
        aria-label={label}
        onChange={(evenement) =>
          onChange(
            [
              // Les tokens déjà posés survivent à la frappe — c'est ce que fait la vraie
              // barre, et l'onglet Mentions en dépend.
              ...filters.filter((filtre) => filtre.field !== "texte"),
              tokenTexte(evenement.target.value),
            ],
            "edit",
            0,
          )
        }
      />
    ),
  };
});

const restoreSession = vi.fn<() => Promise<Session | null>>();
vi.mock("@tacita/client-core", async (original) => ({
  ...(await original<typeof import("@tacita/client-core")>()),
  initSession: vi.fn(),
  restoreSession: () => restoreSession(),
}));

const salons: Conversation[] = [
  { roomId: "!dm:t", name: "adam", direct: true, peerId: "@adam:t", preview: "", timestamp: 0, unread: 0, mention: false, pinned: false },
  { roomId: "!groupe:t", name: "équipe adam", direct: false, preview: "", timestamp: 0, unread: 0, mention: false, pinned: false },
];
vi.mock("@tacita/messaging", () => ({
  conversations: () => salons,
  ROOM_MENTION: "@room",
}));

/** Le paquet search est mocké à son interface (spec 11) : aucun worker, aucun Orama. */
const chercher = vi.fn<(query: string, filters?: SearchFilters) => Promise<SearchHit[]>>();
const stats = vi.fn<() => Promise<SearchStats>>();
const disposer = vi.fn();
vi.mock("@tacita/search", () => ({
  ROOM_MENTION: "@room",
  createSearch: () => ({
    search: (query: string, filters?: SearchFilters) => chercher(query, filters),
    stats: () => stats(),
    index: vi.fn(),
    wipe: vi.fn(),
    dispose: disposer,
  }),
}));

const hit = (partiel: Partial<SearchHit> = {}): SearchHit => ({
  eventId: "$m1",
  roomId: "!dm:t",
  sender: "@adam:t",
  tsOrigin: new Date("2026-08-05T10:00:00").getTime(),
  body: "on se voit demain au bureau",
  msgtype: "m.text",
  mentions: [],
  score: 1,
  ...partiel,
});

const rendreRecherche = (variation: "search" | "mentions" = "search") =>
  render(
    <SessionProvider homeserverUrl="https://chat.tacita.test" rediriger={vi.fn()}>
      <Recherche variation={variation} />
    </SessionProvider>,
  );

const saisir = async (terme: string) => {
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: terme } });
};

beforeEach(() => {
  // jsdom n'implémente pas `Worker` : c'est une lacune d'environnement, et le paquet
  // qui le consomme est mocké de toute façon.
  globalThis.Worker = class {
    terminate() {}
    postMessage() {}
  } as unknown as typeof Worker;

  chercher.mockResolvedValue([]);
  stats.mockResolvedValue({
    size: 1200,
    max: 50_000,
    oldestTs: new Date("2026-01-02T00:00:00").getTime(),
    newestTs: new Date("2026-08-05T00:00:00").getTime(),
  });
  restoreSession.mockResolvedValue(
    asSession({
      client: { getUserId: () => "@luca:t" },
      recoveryRequired: async () => false,
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("REQ-UI-16 — le périmètre de la recherche est affiché, pas sous-entendu", () => {
  it("rend les bornes réelles de l'index", async () => {
    rendreRecherche();

    // REQ-SRC-06 : ce que l'index couvre vraiment. Sans ces bornes, l'utilisateur croit
    // chercher dans tout son historique serveur.
    await waitFor(() => expect(screen.getByText(/historique téléchargé/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/1200 messages indexés sur 50000/)).toBeTruthy());
  });

  it("un index sans bornes n'invente pas de dates", async () => {
    stats.mockResolvedValue({ size: 0, max: 50_000, oldestTs: null, newestTs: null });
    rendreRecherche();

    await waitFor(() => expect(screen.getByText(/0 messages indexés/)).toBeTruthy());
    expect(screen.queryByText(/du .* au /)).toBeNull();
  });
});

describe("REQ-UIX-19 — recherches récentes : scroller, content peek, purge", () => {
  const recentes = (nombre: number) =>
    Array.from({ length: nombre }, (_unused, rang) => ({ roomId: `!r${rang}:t`, nom: `ami ${rang}` }));

  it("au-delà de ce qui tient à l'écran, le dernier élément dépasse au lieu d'être coupé net", () => {
    const { container } = render(
      <RecentSearches recentes={recentes(VISIBLES_SANS_DEBORDEMENT + 1)} onOuvrir={vi.fn()} onPurger={vi.fn()} />,
    );

    const scroller = container.querySelector("[data-debordement]") as HTMLElement;
    expect(scroller.dataset.debordement).toBe("true");
    // Le « peek » est ce rembourrage de fin : il laisse voir qu'il y a une suite.
    expect(scroller.style.paddingInlineEnd).toBe("44px");
    expect(scroller.style.overflowX).toBe("auto");
  });

  it("ce qui tient à l'écran ne porte pas de rembourrage de débordement", () => {
    const { container } = render(
      <RecentSearches recentes={recentes(2)} onOuvrir={vi.fn()} onPurger={vi.fn()} />,
    );
    expect((container.querySelector("[data-debordement]") as HTMLElement).dataset.debordement).toBe("false");
  });

  it("aucun historique : un Placeholder, pas un scroller vide", () => {
    render(<RecentSearches recentes={[]} onOuvrir={vi.fn()} onPurger={vi.fn()} />);
    expect(screen.getByText("Aucune recherche récente")).toBeTruthy();
  });

  it("la liste se purge, et se dédoublonne en gardant la plus récente en tête", () => {
    const onPurger = vi.fn();
    render(<RecentSearches recentes={recentes(2)} onOuvrir={vi.fn()} onPurger={onPurger} />);
    fireEvent.click(screen.getByRole("button", { name: "Effacer" }));
    expect(onPurger).toHaveBeenCalledTimes(1);

    const empilee = empiler([{ roomId: "!a:t", nom: "a" }, { roomId: "!b:t", nom: "b" }], { roomId: "!b:t", nom: "b" });
    expect(empilee.map((item) => item.roomId)).toEqual(["!b:t", "!a:t"]);
    expect(empiler(recentes(MAX_RECENTES), { roomId: "!neuf:t", nom: "neuf" })).toHaveLength(MAX_RECENTES);
  });
});

describe("REQ-UIX-20 — résultats : deux sections, et les occurrences surlignées", () => {
  it("découpe le texte autour du terme, sans distinguer la casse", () => {
    expect(decouper("Bureau du bureau", "bureau").filter((m) => m.surligne).map((m) => m.valeur)).toEqual([
      "Bureau",
      "bureau",
    ]);
    // La casse d'origine est conservée : on surligne le texte de l'auteur.
    expect(decouper("rien", "")).toEqual([{ valeur: "rien", surligne: false }]);
  });

  it("le message preview porte la conversation, la date et l'extrait surligné", () => {
    render(
      <MessagePreview
        conversation="adam"
        extrait="on se voit au bureau"
        horodatage={new Date("2026-08-05T10:00:00").getTime()}
        terme="bureau"
        onOuvrir={vi.fn()}
        maintenant={new Date("2026-08-05T18:00:00").getTime()}
      />,
    );

    expect(screen.getByText("adam")).toBeTruthy();
    expect(screen.getByText("bureau").tagName).toBe("MARK");
  });

  it("des résultats mixtes rendent la section Conversations et la section Messages", async () => {
    chercher.mockResolvedValue([hit()]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rendreRecherche();

    await saisir("adam");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    // « adam » est un nom de conversation **et** un mot du corps : les deux sections.
    await waitFor(() => expect(screen.getByRole("region", { name: "Conversations" })).toBeTruthy());
    expect(screen.getByRole("region", { name: "Messages" })).toBeTruthy();
  });

  it("un résultat de message ouvre la conversation positionnée sur lui", async () => {
    chercher.mockResolvedValue([hit({ eventId: "$cible" })]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rendreRecherche();

    await saisir("bureau");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    const messages = within(await screen.findByRole("region", { name: "Messages" }));
    fireEvent.click(messages.getAllByRole("button")[0]!);
    await waitFor(() => expect(pousser).toHaveBeenCalledWith("/c/!dm:t?message=$cible"));
  });

  it("aucun résultat : un Placeholder qui rappelle le périmètre", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rendreRecherche();

    await saisir("introuvable");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    await waitFor(() => expect(screen.getByText("Aucun résultat")).toBeTruthy());
    expect(screen.getByText(/historique téléchargé sur cet appareil/)).toBeTruthy();
  });
});

describe("REQ-UIX-21 — filtres : chacun arrive au moteur sous le nom qu'il comprend", () => {
  const filtre = (field: string, value: string) => ({ field, operator: "est", value: { type: "string" as const, value } });

  it("chaque champ de la barre devient son critère d'index", () => {
    expect(versCriteres([filtre(CHAMP_TEXTE, "bureau")])).toEqual({ terme: "bureau", criteres: {} });
    expect(versCriteres([filtre(CHAMP_PERSONNE, "@adam:t")]).criteres).toEqual({ sender: "@adam:t" });
    expect(versCriteres([filtre(CHAMP_CONVERSATION, "!dm:t")]).criteres).toEqual({ roomId: "!dm:t" });
    expect(versCriteres([filtre(CHAMP_TYPE, "m.image")]).criteres).toEqual({ msgtype: "m.image" });
    expect(
      versCriteres([{ field: CHAMP_APRES, operator: "le", value: { type: "date_absolute", unixSeconds: 1_700_000 } }])
        .criteres,
    ).toEqual({ since: 1_700_000_000 });
  });

  it("deux filtres combinés donnent l'intersection, pas le dernier", () => {
    const { terme, criteres } = versCriteres([
      filtre(CHAMP_TEXTE, "bureau"),
      filtre(CHAMP_PERSONNE, "@adam:t"),
      filtre(CHAMP_TYPE, "m.image"),
    ]);
    expect(terme).toBe("bureau");
    expect(criteres).toEqual({ sender: "@adam:t", msgtype: "m.image" });
  });

  it("un token vide n'est pas un critère vide", () => {
    // `sender: ""` ne rendrait aucun résultat au lieu de ne pas filtrer.
    expect(versCriteres([filtre(CHAMP_PERSONNE, "")]).criteres).toEqual({});
  });

  it("l'onglet Mentions interroge le champ mentions, jamais un nom d'affichage", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rendreRecherche("mentions");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    await waitFor(() => expect(chercher).toHaveBeenCalled());
    const [terme, criteres] = chercher.mock.calls.at(-1)!;

    // Terme **vide** et critère `mentions` : une recherche plein-texte sur « luca »
    // trouverait les messages qui parlent de lui, pas ceux qui le mentionnent.
    expect(terme).toBe("");
    expect(criteres?.mentions).toEqual(["@luca:t", "@room"]);
  });

  it("les tokens de mentions sont en lecture seule : ils sont l'onglet, pas un filtre", () => {
    const tokens = tokensMentions("@luca:t", "@room");
    expect(tokens.every((token) => token.isReadOnly)).toBe(true);
    expect(tokens.map((token) => token.field)).toEqual([CHAMP_MENTIONS, CHAMP_MENTIONS]);
  });

  it("« exclure les groupes » retire les résultats venus d'un salon de groupe", async () => {
    chercher.mockResolvedValue([hit({ eventId: "$dm" }), hit({ eventId: "$grp", roomId: "!groupe:t" })]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rendreRecherche("mentions");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    const messages = () => within(screen.getByRole("region", { name: "Mentions" }));
    await waitFor(() => expect(messages().getAllByRole("button")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Exclure les groupes" }));
    await waitFor(() => expect(messages().getAllByRole("button")).toHaveLength(1));
  });
});

describe("REQ-UIX-22 — une requête par pause de frappe, et zéro appel réseau", () => {
  it("vingt frappes ne produisent qu'une seule recherche", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rendreRecherche();

    const champ = await screen.findByRole("combobox");
    for (let frappe = 0; frappe < 20; frappe++) {
      fireEvent.change(champ, { target: { value: "bureau".slice(0, (frappe % 6) + 1) } });
      await vi.advanceTimersByTimeAsync(10);
    }
    fireEvent.keyDown(champ, { key: "Enter" });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    await waitFor(() => expect(chercher).toHaveBeenCalledTimes(1));
  });

  it("la recherche est locale : aucun appel réseau, jamais", async () => {
    const reseau = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("réseau interdit"));
    chercher.mockResolvedValue([hit()]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rendreRecherche();

    await saisir("bureau");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await waitFor(() => expect(chercher).toHaveBeenCalled());

    // REQ-SRC-03 : l'index est local, et l'écran hors ligne doit rester utile.
    expect(reseau).not.toHaveBeenCalled();
  });

  it("le worker est terminé au démontage", async () => {
    const { unmount } = rendreRecherche();
    await waitFor(() => expect(stats).toHaveBeenCalled());
    unmount();
    expect(disposer).toHaveBeenCalledTimes(1);
  });
});
