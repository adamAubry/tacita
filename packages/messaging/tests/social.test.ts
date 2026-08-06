import { describe, expect, it } from "vitest";

import {
  acceptInvitation,
  ignoredUsers,
  ignoreUser,
  leaveConversation,
  profileOf,
  searchUsers,
  unignoreUser,
  updateProfile,
} from "../src/social";
import { fakeSession } from "./session-mock";

const MIRA = "@mira:tacita.test";

describe("REQ-MSG-16 — accepter, refuser, quitter : trois gestes, deux appels natifs", () => {
  it("accepter une demande d'ami est un join, et rend le salon à ouvrir", async () => {
    const { session, client } = fakeSession();

    await expect(acceptInvitation(session, "!dm:tacita.test")).resolves.toBe("!dm:tacita.test");
    expect(client.joinRoom).toHaveBeenCalledWith("!dm:tacita.test");
  });

  it("refuser une demande et retirer un ami sont le même leave", async () => {
    const { session, client } = fakeSession();

    await leaveConversation(session, "!dm:tacita.test");
    expect(client.leave).toHaveBeenCalledWith("!dm:tacita.test");
    // D-09 : il n'existe aucun registre d'amitié à mettre à jour en plus.
    expect(client.sendStateEvent).not.toHaveBeenCalled();
  });
});

describe("REQ-MSG-17 — blocage par m.ignored_user_list natif", () => {
  it("bloquer ajoute à la liste existante au lieu de l'écraser", async () => {
    const { session, client } = fakeSession({ ignored: ["@sam:tacita.test"] });

    await ignoreUser(session, MIRA);
    expect(client.setIgnoredUsers).toHaveBeenCalledWith(["@sam:tacita.test", MIRA]);
    // La lecture suit l'écriture : une seule source, celle du SDK.
    expect(ignoredUsers(session)).toEqual(["@sam:tacita.test", MIRA]);
  });

  it("bloquer deux fois n'écrit qu'une fois", async () => {
    const { session, client } = fakeSession({ ignored: [MIRA] });

    await ignoreUser(session, MIRA);
    expect(client.setIgnoredUsers).not.toHaveBeenCalled();
  });

  it("débloquer retire, et ne touche pas aux autres", async () => {
    const { session, client } = fakeSession({ ignored: ["@sam:tacita.test", MIRA] });

    await unignoreUser(session, MIRA);
    expect(client.setIgnoredUsers).toHaveBeenCalledWith(["@sam:tacita.test"]);

    client.setIgnoredUsers.mockClear();
    await unignoreUser(session, "@inconnu:tacita.test");
    expect(client.setIgnoredUsers).not.toHaveBeenCalled();
  });
});

describe("REQ-MSG-18 — profil : lecture tolérante, écriture sélective", () => {
  it("un profil complet est rendu tel quel", async () => {
    const { session } = fakeSession({
      profile: { displayname: "mira", avatar_url: "mxc://tacita.test/abc" },
    });

    await expect(profileOf(session, MIRA)).resolves.toEqual({
      userId: MIRA,
      displayName: "mira",
      avatarUrl: "mxc://tacita.test/abc",
    });
  });

  it("un compte sans nom retombe sur son identifiant, pas sur du vide", async () => {
    const { session } = fakeSession({ profile: {} });

    const profil = await profileOf(session, MIRA);
    expect(profil.displayName).toBe(MIRA);
    expect(profil.avatarUrl).toBeUndefined();
  });

  it("un profil introuvable ne fait pas échouer l'écran", async () => {
    const { session, client } = fakeSession();
    client.getProfileInfo.mockRejectedValue(new Error("404"));

    await expect(profileOf(session, MIRA)).resolves.toEqual({
      userId: MIRA,
      displayName: MIRA,
    });
  });

  it("ne changer que le nom n'efface pas la photo", async () => {
    const { session, client } = fakeSession();

    await updateProfile(session, { displayName: "adam" });
    expect(client.setDisplayName).toHaveBeenCalledWith("adam");
    expect(client.setAvatarUrl).not.toHaveBeenCalled();

    await updateProfile(session, { avatarUrl: "mxc://tacita.test/nouveau" });
    expect(client.setAvatarUrl).toHaveBeenCalledWith("mxc://tacita.test/nouveau");
    expect(client.setDisplayName).toHaveBeenCalledTimes(1);
  });

  it("un nom vidé est une valeur, pas une absence — il part", async () => {
    const { session, client } = fakeSession();

    await updateProfile(session, { displayName: "" });
    expect(client.setDisplayName).toHaveBeenCalledWith("");
  });
});

describe("REQ-MSG-19 — annuaire du homeserver, jamais /search", () => {
  it("les résultats sont normalisés en Profile", async () => {
    const { session, client } = fakeSession({
      annuaire: [
        { user_id: MIRA, display_name: "mira", avatar_url: "mxc://tacita.test/m" },
        { user_id: "@sam:tacita.test" },
      ],
    });

    await expect(searchUsers(session, "mi")).resolves.toEqual([
      { userId: MIRA, displayName: "mira", avatarUrl: "mxc://tacita.test/m" },
      { userId: "@sam:tacita.test", displayName: "@sam:tacita.test", avatarUrl: undefined },
    ]);
    expect(client.searchUserDirectory).toHaveBeenCalledWith({ term: "mi", limit: 20 });
  });

  it("un terme vide ne part pas — l'annuaire rendrait un échantillon arbitraire", async () => {
    const { session, client } = fakeSession();

    await expect(searchUsers(session, "   ")).resolves.toEqual([]);
    expect(client.searchUserDirectory).not.toHaveBeenCalled();
  });
});
