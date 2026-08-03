import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createDirectMessage,
  createGroupChat,
  getPinnedEvents,
  memberCount,
  PINNED_EVENTS_METADATA,
  powerLevelOf,
  setPinnedEvents,
  setPowerLevel,
} from "../src";
import { fakeMember, fakeSession } from "./session-mock";

const ROOM = "!salon:tacita.test";

let ctx: ReturnType<typeof fakeSession>;

beforeEach(() => {
  ctx = fakeSession({
    members: [fakeMember("@luca:tacita.test", "luca", 100), fakeMember("@adam:tacita.test", "adam")],
    pinned: ["$epingle"],
  });
});

describe("REQ-MSG-02 — DM et groupes, chiffrés dès la création", () => {
  it("un DM est un salon à 2 marqué is_direct et chiffré à la création", async () => {
    await createDirectMessage(ctx.session, "@adam:tacita.test");
    const [opts] = ctx.client.createRoom.mock.calls[0]!;
    expect(opts).toMatchObject({ is_direct: true, invite: ["@adam:tacita.test"] });
    expect(opts.initial_state).toEqual([
      { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
    ]);
  });

  it("un groupe est chiffré à la création lui aussi", async () => {
    await createGroupChat(ctx.session, "équipe", ["@adam:tacita.test"]);
    const [opts] = ctx.client.createRoom.mock.calls[0]!;
    expect(opts).toMatchObject({ name: "équipe", invite: ["@adam:tacita.test"] });
    expect(opts.initial_state?.[0]?.type).toBe("m.room.encryption");
    expect(opts.is_direct).toBeUndefined();
  });

  it("la vérification client refuse toute écriture dans un salon non chiffré", async () => {
    ctx.crypto.isEncryptionEnabledInRoom.mockResolvedValue(false);
    await expect(setPinnedEvents(ctx.session, ROOM, ["$a"])).rejects.toThrow(/non chiffré/);
    expect(ctx.client.sendStateEvent).not.toHaveBeenCalled();
  });

  it("un client sans crypto ne peut rien écrire non plus", async () => {
    ctx.client.getCrypto.mockReturnValue(undefined as never);
    await expect(setPinnedEvents(ctx.session, ROOM, ["$a"])).rejects.toThrow(/non chiffré/);
  });
});

describe("REQ-MSG-08 — épinglage via m.room.pinned_events, état non chiffré", () => {
  it("écrit la liste dans l'événement d'état", async () => {
    await setPinnedEvents(ctx.session, ROOM, ["$a", "$b"]);
    expect(ctx.client.sendStateEvent).toHaveBeenCalledWith(
      ROOM,
      "m.room.pinned_events",
      { pinned: ["$a", "$b"] },
      "",
    );
  });

  it("relit la liste épinglée depuis l'état du salon", () => {
    expect(getPinnedEvents(ctx.session, ROOM)).toEqual(["$epingle"]);
  });

  it("expose cleartext: true et le documente", () => {
    expect(PINNED_EVENTS_METADATA.cleartext).toBe(true);
    expect(PINNED_EVENTS_METADATA.reason).toMatch(/état/i);
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
    expect(readme).toMatch(/pinned_events/);
  });
});

describe("REQ-MSG-11 — power levels numériques, aucun rôle nommé", () => {
  it("lit le power level d'un membre tel quel", () => {
    expect(powerLevelOf(ctx.session, ROOM, "@luca:tacita.test")).toBe(100);
    expect(powerLevelOf(ctx.session, ROOM, "@adam:tacita.test")).toBe(0);
    expect(powerLevelOf(ctx.session, ROOM, "@inconnu:tacita.test")).toBe(0);
  });

  it("écrit un power level via le SDK", async () => {
    await setPowerLevel(ctx.session, ROOM, "@adam:tacita.test", 50);
    expect(ctx.client.setPowerLevel).toHaveBeenCalledWith(ROOM, "@adam:tacita.test", 50);
  });

  it("expose le compteur de membres du salon", () => {
    expect(memberCount(ctx.session, ROOM)).toBe(2);
  });

  it("aucune échelle de rôles nommés n'est introduite", () => {
    const source = readFileSync(new URL("../src/rooms.ts", import.meta.url), "utf-8");
    expect(source).not.toMatch(/\b(moderator|modérateur|administrateur|OWNER|ROLES?)\b/i);
  });
});
