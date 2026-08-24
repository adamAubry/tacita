import type { RecoveryState, Session } from "@tacita/client-core";
import { asSession } from "@tacita/client-core/testing";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IosPushEducation } from "../components/onboarding/IosPushEducation";
import { LogoutButton } from "../components/onboarding/LogoutButton";
import { RecoveryGate } from "../components/onboarding/RecoveryGate";
import { SessionProvider } from "../components/onboarding/SessionProvider";
import { retirerJetonDeLUrl, urlConnexion } from "../lib/session";
import { ecrireRefusEducationIOS } from "../lib/preferences";

const HOMESERVER = "https://chat.tacita.test";
const MOI = "@moi:tacita.test";

const initSession = vi.fn<() => Promise<Session>>();
const restoreSession = vi.fn<() => Promise<Session | null>>();
vi.mock("@tacita/client-core", async (original) => ({
  ...(await original<typeof import("@tacita/client-core")>()),
  initSession: () => initSession(),
  restoreSession: () => restoreSession(),
}));

/**
 * `asSession` de `client-core/testing` plutôt qu'un `as unknown as Session` : un membre
 * ajouté au contrat de `Session` doit casser la compilation d'un seul fichier, pas
 * disparaître en `undefined is not a function` à l'exécution (specs/00-conventions.md).
 */
function fausseSession(options: { recuperation?: RecoveryState } = {}) {
  const setupRecoveryKey = vi.fn(
    async (_options?: {
      reinitialiser?: boolean;
      confirmerIdentite?: (url: string) => Promise<void>;
    }) => ({
      encodedPrivateKey: "EsTb ABCD EFGH IJKL",
      privateKey: new Uint8Array(32),
    }),
  );
  const unlockRecovery = vi.fn(async (_cle: string) => {});
  const logout = vi.fn(async () => {});
  const session = asSession({
    // `client` est un faux assumé : exiger un vrai `MatrixClient` demanderait 357
    // propriétés.
    client: { getUserId: () => MOI, on: vi.fn(), off: vi.fn() },
    recoveryState: vi.fn(async () => options.recuperation ?? "prete"),
    setupRecoveryKey,
    unlockRecovery,
    logout,
  });
  return { session, setupRecoveryKey, unlockRecovery, logout };
}

const rediriger = vi.fn();

const monter = (session: Session | null, enfant = <p>Conversations</p>) => {
  restoreSession.mockResolvedValue(session);
  return render(
    <SessionProvider homeserverUrl={HOMESERVER} rediriger={rediriger}>
      <RecoveryGate>{enfant}</RecoveryGate>
    </SessionProvider>,
  );
};

beforeEach(() => {
  globalThis.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  // `restoreAllMocks` et non `clearAllMocks` : les espions posés sur `navigator` et
  // `matchMedia` par les tests iOS survivraient au fichier et casseraient les suivants.
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  initSession.mockReset();
  restoreSession.mockReset();
  rediriger.mockReset();
});

describe("REQ-UI-04 — l'étape de clé de récupération est bloquante", () => {
  it("tant que la récupération est requise, aucun contenu d'app n'est rendu", async () => {
    const { session } = fausseSession({ recuperation: "creation" });
    monter(session);

    await waitFor(() => expect(screen.getByText("Votre clé de récupération")).toBeTruthy());
    // Le contenu demandé n'est pas caché : il n'est pas rendu du tout.
    expect(screen.queryByText("Conversations")).toBeNull();
  });

  it("elle ne se contourne pas par l'URL : ce n'est pas une route, c'est le shell", async () => {
    const { session } = fausseSession({ recuperation: "creation" });
    // Quelle que soit l'adresse demandée, c'est l'étape qui rend.
    globalThis.history.replaceState(null, "", "/c/!salon:tacita.test");
    monter(session, <p>Conversations</p>);

    await waitFor(() => expect(screen.getByText("Votre clé de récupération")).toBeTruthy());
    expect(screen.queryByText("Conversations")).toBeNull();
  });

  it("la clé est affichée une fois, et la confirmation libère l'accès", async () => {
    const { session, setupRecoveryKey } = fausseSession({ recuperation: "creation" });
    monter(session);

    await waitFor(() => expect(screen.getByText("Continuer")).toBeTruthy());
    fireEvent.click(screen.getByText("Continuer"));

    // La clé est rendue en groupes de quatre sur une grille — ce qui se transcrit à la
    // main sans perdre sa place. On lit donc le bloc entier, pas un nœud de texte : c'est
    // aussi ce qui prouve qu'aucun groupe ne manque.
    await waitFor(() => expect(screen.getByTestId("cle-de-recuperation")).toBeTruthy());
    expect(screen.getByTestId("cle-de-recuperation").textContent).toBe("EsTbABCDEFGHIJKL");
    expect(setupRecoveryKey).toHaveBeenCalledTimes(1);
    // La promesse est tenue telle qu'elle est faite : elle ne sera plus affichée.
    expect(screen.getByText(/ne sera plus affichée/)).toBeTruthy();

    fireEvent.click(screen.getByText("J'ai sauvegardé ma clé"));
    await waitFor(() => expect(screen.getByText("Conversations")).toBeTruthy());
  });

  it("dit la vérité sur ce qu'on perd sans la clé", async () => {
    const { session } = fausseSession({ recuperation: "creation" });
    monter(session);

    // Interdit n°13 : la limite se documente là où elle se joue, pas dans une note.
    await waitFor(() => expect(screen.getByText(/définitivement perdu/)).toBeTruthy());
    expect(screen.getByText(/personne, chez nous, ne peut le récupérer/)).toBeTruthy();
  });

  it("« en savoir plus » sort dans un onglet neuf, sans quitter l'étape", async () => {
    const { session } = fausseSession({ recuperation: "creation" });
    monter(session);

    // L'étape bloque toute l'app : une navigation dans le même onglet la détruirait, et
    // le retour rejouerait le montage de session. `noopener` parce que la page ouverte
    // garderait sinon une poignée sur celle-ci.
    const lien = await screen.findByRole("link", { name: /En savoir plus/ });
    expect(lien.getAttribute("target")).toBe("_blank");
    expect(lien.getAttribute("rel")).toContain("noopener");
    expect(lien.getAttribute("href")).toBe(
      "https://www.google.com/search?q=a+quoi+sert+une+cle+de+recuperation",
    );
  });

  it("hors contexte sécurisé, l'échec est nommé — pas « réessayez »", async () => {
    // Interdit n°13 : `crypto.subtle` n'existe pas hors `https`/`localhost`, donc la clé
    // ne pourra jamais être créée à cette adresse. Inviter à réessayer serait faux.
    const { session, setupRecoveryKey } = fausseSession({ recuperation: "creation" });
    setupRecoveryKey.mockRejectedValueOnce(new TypeError("crypto.subtle is undefined"));
    // `stubGlobal` et non `spyOn` : jsdom ne définit pas `isSecureContext`, il n'y a donc
    // aucun accesseur à espionner. Le défaut `undefined` reste traité comme « je ne sais
    // pas » — seul un `false` explicite nomme l'origine.
    vi.stubGlobal("isSecureContext", false);
    monter(session);

    await waitFor(() => expect(screen.getByText("Continuer")).toBeTruthy());
    fireEvent.click(screen.getByText("Continuer"));

    await waitFor(() => expect(screen.getByText(/adresse non sécurisée/)).toBeTruthy());
    expect(screen.queryByText(/Vérifiez votre connexion/)).toBeNull();
  });

  it("aucune UI de mot de passe : la connexion part chez le fournisseur", () => {
    const url = new URL(urlConnexion(HOMESERVER, "https://app.tacita.test"));
    expect(url.pathname).toBe("/_matrix/client/v3/login/sso/redirect");
    /*
     * **La barre finale n'est pas cosmétique.** Synapse compare cette valeur aux entrées
     * de `sso.client_whitelist` par préfixe de chaîne ; l'entrée rendue par
     * `synapse/entrypoint.sh` vaut `https://${SERVER_NAME}/`. Sans la barre, la
     * comparaison échoue et Synapse intercale `sso_redirect_confirm.html` — un clic de
     * plus, sur une page qui n'est pas la nôtre, à chaque connexion.
     */
    expect(url.searchParams.get("redirectUrl")).toBe("https://app.tacita.test/");
  });

  it("un chemin est préservé, et reste couvert par la whitelist", () => {
    const url = new URL(urlConnexion(HOMESERVER, "https://app.tacita.test/i/jeton"));
    expect(url.searchParams.get("redirectUrl")).toBe("https://app.tacita.test/i/jeton");
    expect(url.searchParams.get("redirectUrl")?.startsWith("https://app.tacita.test/")).toBe(true);
  });
});

describe("REQ-UIX-06 — reprise de session, retour OIDC, déconnexion", () => {
  it("une session valide arrive directement sur le contenu", async () => {
    const { session } = fausseSession();
    monter(session);

    await waitFor(() => expect(screen.getByText("Conversations")).toBeTruthy());
    expect(rediriger).not.toHaveBeenCalled();
  });

  it("sans session restaurable, retour à l'OIDC sans écran intermédiaire", async () => {
    monter(null);

    await waitFor(() => expect(rediriger).toHaveBeenCalledTimes(1));
    expect(rediriger.mock.calls[0]![0]).toContain("/login/sso/redirect");
    // Aucun formulaire, aucun bouton « se connecter » : la redirection est déjà partie.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("un jeton révoqué ou une crypto absente ramènent à l'OIDC, sans rien journaliser", async () => {
    restoreSession.mockRejectedValue(new Error("M_UNKNOWN_TOKEN"));
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <SessionProvider homeserverUrl={HOMESERVER} rediriger={rediriger}>
        <RecoveryGate>
          <p>Conversations</p>
        </RecoveryGate>
      </SessionProvider>,
    );

    await waitFor(() => expect(rediriger).toHaveBeenCalledTimes(1));
    expect(journal).not.toHaveBeenCalled();
    journal.mockRestore();
  });

  it("le jeton de connexion est retiré de l'URL, donc de l'historique", () => {
    globalThis.history.replaceState(null, "", "/?loginToken=syt_secret&autre=1");

    const jeton = retirerJetonDeLUrl(globalThis.location, globalThis.history);

    expect(jeton).toBe("syt_secret");
    expect(globalThis.location.search).toBe("?autre=1");
    // `replaceState` et non `pushState` : l'entrée qui portait le jeton est remplacée.
    expect(globalThis.location.href).not.toContain("syt_secret");
  });

  it("la déconnexion n'efface qu'après confirmation, et dit ce qu'elle efface", async () => {
    const { session, logout } = fausseSession();
    render(
      <SessionProvider homeserverUrl={HOMESERVER} rediriger={rediriger}>
        <LogoutButton session={session} />
      </SessionProvider>,
    );

    // `<dialog>` garde son contenu dans le DOM même fermé : le déclencheur est le
    // premier des deux boutons portant ce libellé, la confirmation le dernier.
    fireEvent.click(screen.getAllByText("Se déconnecter")[0]!);
    await waitFor(() => expect(screen.getByText("Vos messages déjà déchiffrés")).toBeTruthy());
    expect(screen.getByText("Les messages en attente d'envoi")).toBeTruthy();
    // Rien n'a encore été effacé : la confirmation n'est pas décorative.
    expect(logout).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByText("Se déconnecter").at(-1)!);
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(rediriger).toHaveBeenCalled();
  });
});

describe("REQ-UI-18 — éducation iOS, au bon moment et une seule fois", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15";

  const simuler = (userAgent: string, standalone: boolean) => {
    vi.spyOn(globalThis.navigator, "userAgent", "get").mockReturnValue(userAgent);
    // Une `MediaQueryList` réduite à `matches` ne suffit pas : Astryx s'abonne aux
    // changements, et un objet sans `addEventListener` fait lever le rendu.
    vi.spyOn(globalThis, "matchMedia").mockReturnValue({
      matches: standalone,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
  };

  it("s'affiche sur iOS hors écran d'accueil, au point de friction", async () => {
    simuler(IPHONE, false);
    render(<IosPushEducation declenche indexedDB={new IDBFactory()} />);

    await waitFor(() => expect(screen.getByText(/écran/)).toBeTruthy());
    expect(screen.getByText(/contrainte de Safari/)).toBeTruthy();
  });

  it("ne s'affiche pas au premier lancement, tant que rien ne le déclenche", async () => {
    simuler(IPHONE, false);
    const { container } = render(<IosPushEducation declenche={false} indexedDB={new IDBFactory()} />);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(container.textContent).toBe("");
  });

  it("ne s'affiche ni en PWA installée, ni hors iOS", async () => {
    simuler(IPHONE, true);
    const { container: installee } = render(<IosPushEducation declenche indexedDB={new IDBFactory()} />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(installee.textContent).toBe("");

    cleanup();
    simuler("Mozilla/5.0 (Linux; Android 14)", false);
    const { container: android } = render(<IosPushEducation declenche indexedDB={new IDBFactory()} />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(android.textContent).toBe("");
  });

  it("après un refus explicite, il n'est jamais re-présenté", async () => {
    simuler(IPHONE, false);
    const indexedDB = new IDBFactory();
    await ecrireRefusEducationIOS(indexedDB);

    const { container } = render(<IosPushEducation declenche indexedDB={indexedDB} />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(container.textContent).toBe("");
  });
});

describe("REQ-UI-04 / REQ-UI-17 — à la reconnexion, la porte demande la clé, elle n'en refait pas une", () => {
  const saisir = (valeur: string) =>
    fireEvent.change(screen.getByLabelText(/Clé de récupération/), { target: { value: valeur } });

  it("un appareil neuf sur un compte qui a sa clé : on la demande, on ne propose pas d'en créer une", async () => {
    // Le défaut réparé. Chaque `m.login.token` donne un `device_id` neuf, donc un
    // appareil non signé : l'écran de création s'ouvrait devant quelqu'un qui avait sa
    // clé depuis des mois, et son seul bouton aurait écrasé la sauvegarde du compte.
    const { session } = fausseSession({ recuperation: "deverrouillage" });
    monter(session);

    await waitFor(() => expect(screen.getByText("Entrez votre clé de récupération")).toBeTruthy());
    expect(screen.queryByText("Votre clé de récupération")).toBeNull();
    expect(screen.queryByText("Continuer")).toBeNull();
    expect(screen.queryByText("Conversations")).toBeNull();
  });

  it("la clé saisie déverrouille l'appareil et libère l'accès", async () => {
    const { session, unlockRecovery } = fausseSession({ recuperation: "deverrouillage" });
    monter(session);

    await waitFor(() => expect(screen.getByText("Déverrouiller")).toBeTruthy());
    saisir("EsTb ABCD EFGH");
    fireEvent.click(screen.getByText("Déverrouiller"));

    await waitFor(() => expect(screen.getByText("Conversations")).toBeTruthy());
    expect(unlockRecovery).toHaveBeenCalledWith("EsTb ABCD EFGH");
  });

  it("une clé refusée le dit sur le champ, et n'ouvre rien", async () => {
    // Interdit n°13 : une saisie fausse acceptée en silence débloquerait l'UI devant un
    // client qui ne déchiffrera jamais rien.
    const { session, unlockRecovery } = fausseSession({ recuperation: "deverrouillage" });
    unlockRecovery.mockRejectedValueOnce(new Error("clé de récupération incorrecte"));
    monter(session);

    await waitFor(() => expect(screen.getByText("Déverrouiller")).toBeTruthy());
    saisir("EsTb ZZZZ ZZZZ");
    fireEvent.click(screen.getByText("Déverrouiller"));

    await waitFor(() => expect(screen.getByText(/ne correspond pas à ce compte/)).toBeTruthy());
    expect(screen.queryByText("Conversations")).toBeNull();
  });

  it("une panne ne se dit pas comme une clé fausse", async () => {
    // La différence est utile : une clé refusée se corrige en la retapant, une panne non.
    const { session, unlockRecovery } = fausseSession({ recuperation: "deverrouillage" });
    unlockRecovery.mockRejectedValueOnce(new Error("Failed to fetch"));
    const { container } = monter(session);

    await waitFor(() => expect(screen.getByText("Déverrouiller")).toBeTruthy());
    saisir("EsTb ABCD EFGH");
    fireEvent.click(screen.getByText("Déverrouiller"));

    await waitFor(() => expect(screen.getByText(/Vérifiez votre connexion/)).toBeTruthy());
    // `container` et non `screen` : Astryx pose sa région `aria-live` sur `document.body`,
    // hors de l'arbre rendu, et elle garde l'annonce du test précédent.
    expect(within(container).queryByText(/ne correspond pas à ce compte/)).toBeNull();
  });

  it("« je n'ai plus ma clé » dit ce qu'il détruit avant de le faire", async () => {
    const { session, setupRecoveryKey } = fausseSession({ recuperation: "deverrouillage" });
    monter(session);

    await waitFor(() => expect(screen.getByText("Je n'ai plus ma clé")).toBeTruthy());
    fireEvent.click(screen.getByText("Je n'ai plus ma clé"));

    // Rien n'est encore détruit : l'écran annonce, il n'agit pas.
    await waitFor(() => expect(screen.getByText("Repartir d'une clé neuve")).toBeTruthy());
    expect(screen.getByText(/ni vous, ni nous ne pourrons plus les lire/)).toBeTruthy();
    expect(setupRecoveryKey).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Créer une nouvelle clé"));
    await waitFor(() =>
      expect(setupRecoveryKey).toHaveBeenCalledWith(
        expect.objectContaining({ reinitialiser: true }),
      ),
    );
  });

  /*
   * La ré-authentification que Synapse exige pour **remplacer** une identité cross-signing
   * (v1.155.0 : le premier dépôt passe sans UIA, pas le second). Sans mot de passe natif
   * (REQ-INF-09), elle se joue chez Keycloak, dans une fenêtre, et se termine par un
   * `postMessage` de la page de repli du serveur.
   *
   * Le défaut du 09/08/2026 : rien de tout ça n'existait. L'écran appelait, prenait un 401
   * en pleine figure et affichait « vérifiez votre connexion » — alors que la connexion
   * n'y était pour rien et que la sauvegarde venait d'être remplacée.
   */
  const URL_SSO = `${HOMESERVER}/_matrix/client/v3/auth/m.login.sso/fallback/web?session=s1`;

  const jusquAuRemplacement = async (setupRecoveryKey: ReturnType<typeof fausseSession>["setupRecoveryKey"]) => {
    await waitFor(() => expect(screen.getByText("Je n'ai plus ma clé")).toBeTruthy());
    fireEvent.click(screen.getByText("Je n'ai plus ma clé"));
    await waitFor(() => expect(screen.getByText("Repartir d'une clé neuve")).toBeTruthy());
    fireEvent.click(screen.getByText("Créer une nouvelle clé"));
    await waitFor(() => expect(setupRecoveryKey).toHaveBeenCalled());
  };

  it("quand le compte exige une reconnexion, elle est demandée — et n'aboutit que sur le bon émetteur", async () => {
    const { session, setupRecoveryKey } = fausseSession({ recuperation: "deverrouillage" });
    setupRecoveryKey.mockImplementation(async (options) => {
      await options?.confirmerIdentite?.(URL_SSO);
      return { encodedPrivateKey: "EsTb ABCD EFGH IJKL", privateKey: new Uint8Array(32) };
    });
    const ouvrir = vi.spyOn(window, "open").mockReturnValue({} as Window);

    monter(session);
    await jusquAuRemplacement(setupRecoveryKey);

    await waitFor(() => expect(screen.getByText("Confirmez que c'est bien vous")).toBeTruthy());
    fireEvent.click(screen.getByText("Confirmer avec mon compte"));
    // Sans `noopener` : la page de repli a besoin de `window.opener` pour annoncer la fin,
    // et un `target="_blank"` le lui retirerait d'office.
    expect(ouvrir).toHaveBeenCalledWith(URL_SSO, "_blank");

    // Une fenêtre étrangère qui crie « c'est bon » ne franchit rien : `postMessage` accepte
    // n'importe quel émetteur, l'origine est donc vérifiée avant tout.
    window.dispatchEvent(
      new MessageEvent("message", { data: "authDone", origin: "https://ailleurs.test" }),
    );
    expect(screen.getByText("Confirmez que c'est bien vous")).toBeTruthy();

    window.dispatchEvent(new MessageEvent("message", { data: "authDone", origin: HOMESERVER }));
    await waitFor(() => expect(screen.getByText("Notez cette clé maintenant")).toBeTruthy());
  });

  it("annuler la reconnexion le dit sans mentir sur ce qui reste à faire", async () => {
    // À cet instant la sauvegarde a déjà été remplacée côté serveur, mais pas l'identité :
    // « réessayez plus tard » laisserait croire à une session utilisable (interdit n°13).
    const { session, setupRecoveryKey } = fausseSession({ recuperation: "deverrouillage" });
    setupRecoveryKey.mockImplementation(async (options) => {
      await options?.confirmerIdentite?.(URL_SSO);
      return { encodedPrivateKey: "EsTb ABCD EFGH IJKL", privateKey: new Uint8Array(32) };
    });

    monter(session);
    await jusquAuRemplacement(setupRecoveryKey);

    await waitFor(() => expect(screen.getByText("Confirmez que c'est bien vous")).toBeTruthy());
    fireEvent.click(screen.getByText("Annuler"));

    await waitFor(() => expect(screen.getByText("L'étape n'est pas terminée")).toBeTruthy());
    expect(screen.getByText(/n'est pas active et cet appareil ne peut toujours pas chiffrer/)).toBeTruthy();
    // L'écran de remplacement est toujours là, prêt à reprendre.
    expect(screen.getByText("Créer une nouvelle clé")).toBeTruthy();
  });

  it("hors ligne, un appareil déjà signé n'a plus rien à prouver : REQ-UI-17 tient", async () => {
    // Mesuré au navigateur le 08/08/2026 : sans réseau, « une sauvegarde est-elle
    // active ? » rendait `true` pour un compte parfaitement configuré, et la porte —
    // qui *remplace* l'app — emportait l'historique promis consultable. `recoveryState()`
    // lit le magasin crypto local : la trace `recuperation-faite` n'a plus lieu d'être.
    const { session } = fausseSession({ recuperation: "prete" });
    monter(session);

    await waitFor(() => expect(screen.getByText("Conversations")).toBeTruthy());
    expect(screen.queryByText("Entrez votre clé de récupération")).toBeNull();
  });
});
