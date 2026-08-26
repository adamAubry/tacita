import { beforeEach, describe, expect, it } from "vitest";

import { EVERYONE, mentionCandidates, parseMentions, ROOM_MENTION, sendText } from "../src";
import { fakeMember, fakeSession } from "./session-mock";

const ROOM = "!salon:tacita.test";

let ctx: ReturnType<typeof fakeSession>;

beforeEach(() => {
  ctx = fakeSession({
    members: [
      fakeMember("@luca:tacita.test", "luca", 100),
      fakeMember("@adam:tacita.test", "adam"),
      fakeMember("@jean:tacita.test", "Jean Dupont"),
    ],
  });
});

describe("mentions type Discord, @everyone mappé sur @room", () => {
  it("« salut @everyone » produit un contenu de mention room conforme", () => {
    expect(parseMentions("salut @everyone")).toEqual({
      body: "salut @room",
      "m.mentions": { room: true },
    });
  });

  it("le corps porte le littéral @room que cherche .m.rule.roomnotif", () => {
    expect(parseMentions(`coucou ${EVERYONE}`).body).toContain(ROOM_MENTION);
  });

  it("un texte sans mention ne porte aucune métadonnée de mention", () => {
    expect(parseMentions("bonjour tout le monde")).toEqual({
      body: "bonjour tout le monde",
      "m.mentions": {},
    });
  });

  it("@everyoneelse n'est pas une mention room", () => {
    const parsed = parseMentions("coucou @everyoneelse");
    expect(parsed.body).toBe("coucou @everyoneelse");
    expect(parsed["m.mentions"].room).toBeUndefined();
  });

  it("résout les pseudos et les identifiants complets en user_ids", () => {
    const candidates = mentionCandidates(ctx.session, ROOM);
    expect(parseMentions("hé @adam", candidates)["m.mentions"].user_ids).toEqual([
      "@adam:tacita.test",
    ]);
    expect(
      parseMentions("hé @luca:tacita.test", candidates)["m.mentions"].user_ids,
    ).toEqual(["@luca:tacita.test"]);
  });

  it("un pseudo à espaces reste du texte — limite assumée", () => {
    const candidates = mentionCandidates(ctx.session, ROOM);
    expect(parseMentions("hé @Jean Dupont", candidates)["m.mentions"].user_ids).toBeUndefined();
  });

  it("l'autocomplétion propose @everyone puis les membres du salon", () => {
    expect(mentionCandidates(ctx.session, ROOM)).toEqual([
      { id: ROOM_MENTION, label: "everyone" },
      { id: "@luca:tacita.test", label: "luca" },
      { id: "@adam:tacita.test", label: "adam" },
      { id: "@jean:tacita.test", label: "Jean Dupont" },
    ]);
  });

  it("un message envoyé porte la mention parsée, pas la syntaxe saisie", async () => {
    await sendText(ctx.session, ROOM, "réunion @everyone");
    expect(ctx.client.sendEvent.mock.calls[0]![2]).toMatchObject({
      body: "réunion @room",
      "m.mentions": { room: true },
    });
  });
});
