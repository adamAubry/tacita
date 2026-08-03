import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canEdit,
  canRedact,
  edit,
  messages,
  messageText,
  react,
  REACTIONS_METADATA,
  redact,
  reply,
  sendText,
  subscribe,
} from "../src";
import { fakeEvent, fakeSession } from "./session-mock";

const ROOM = "!salon:tacita.test";

let ctx: ReturnType<typeof fakeSession>;

beforeEach(() => {
  ctx = fakeSession();
});

const lastSend = () => ctx.client.sendEvent.mock.calls.at(-1)!;

/** Les interdits portent sur ce que le package exécute, pas sur ce qu'il documente. */
const codeOf = (...names: string[]) =>
  names
    .map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf-8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

describe("REQ-MSG-01 — envoi et réception de messages texte chiffrés", () => {
  it("envoie un m.room.message via la Session", async () => {
    await sendText(ctx.session, ROOM, "salut");
    const [roomId, type, content] = lastSend();
    expect(roomId).toBe(ROOM);
    expect(type).toBe("m.room.message");
    expect(content).toMatchObject({ msgtype: "m.text", body: "salut" });
  });

  it("refuse d'envoyer dans un salon non chiffré", async () => {
    ctx.crypto.isEncryptionEnabledInRoom.mockResolvedValue(false);
    await expect(sendText(ctx.session, ROOM, "salut")).rejects.toThrow(/non chiffré/);
    expect(ctx.client.sendEvent).not.toHaveBeenCalled();
  });

  it("réception : les messages du salon viennent de la timeline de la Session", () => {
    ctx.setTimeline([fakeEvent("$a", { body: "un" }), fakeEvent("$b", { body: "deux" })]);
    expect(messages(ctx.session, ROOM).map((event) => event.getId())).toEqual(["$a", "$b"]);
  });

  it("le signal de changement est branché sur l'émetteur du SDK", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(ctx.session, ROOM, listener);
    expect(ctx.client.on).toHaveBeenCalledWith("Room.timeline", expect.any(Function));
    unsubscribe();
    expect(ctx.client.off).toHaveBeenCalledWith("Room.timeline", expect.any(Function));
  });
});

describe("REQ-MSG-03 — déduplication par txnId, mécanisme natif du SDK", () => {
  it("rejouer la même requête avec le même txnId produit le même event_id", async () => {
    const first = await sendText(ctx.session, ROOM, "salut", { txnId: "txn-1" });
    const second = await sendText(ctx.session, ROOM, "salut", { txnId: "txn-1" });

    expect(second.event_id).toBe(first.event_id);
    expect(ctx.client.sendEvent.mock.calls.map((call) => call[3])).toEqual(["txn-1", "txn-1"]);
  });

  it("sans txnId fourni, aucun n'est fabriqué ici : c'est makeTxnId du SDK qui s'en charge", async () => {
    await sendText(ctx.session, ROOM, "salut");
    expect(lastSend()[3]).toBeUndefined();
  });

  it("aucune déduplication maison n'est empilée par-dessus", () => {
    expect(codeOf("messages.ts")).not.toMatch(/makeTxnId|randomUUID|crypto\.randomUUID/);
  });
});

describe("REQ-MSG-04 — réponse via m.in_reply_to", () => {
  it("attache la relation au message cité", async () => {
    await reply(ctx.session, ROOM, "$cible", "d'accord");
    expect(lastSend()[2]).toMatchObject({
      msgtype: "m.text",
      body: "d'accord",
      "m.relates_to": { "m.in_reply_to": { event_id: "$cible" } },
    });
  });
});

describe("REQ-MSG-05 — réactions emoji en clair, métadonnée exposée", () => {
  it("envoie une annotation m.reaction", async () => {
    await react(ctx.session, ROOM, "$cible", "👍");
    const [, type, content] = lastSend();
    expect(type).toBe("m.reaction");
    expect(content).toEqual({
      "m.relates_to": { rel_type: "m.annotation", event_id: "$cible", key: "👍" },
    });
  });

  it("expose cleartext: true avec la raison", () => {
    expect(REACTIONS_METADATA.cleartext).toBe(true);
    expect(REACTIONS_METADATA.reason).toMatch(/agrég/i);
  });

  it("la limite est documentée, pas masquée", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
    expect(readme).toMatch(/réaction/i);
    expect(readme).toMatch(/clair/i);
  });
});

describe("REQ-MSG-06 — modification, suppression, et droits par message", () => {
  it("l'édition passe par m.replace avec m.new_content", async () => {
    await edit(ctx.session, ROOM, "$cible", "corrigé");
    expect(lastSend()[2]).toMatchObject({
      body: "* corrigé",
      "m.new_content": { msgtype: "m.text", body: "corrigé" },
      "m.relates_to": { rel_type: "m.replace", event_id: "$cible" },
    });
  });

  it("la suppression passe par une redaction", async () => {
    await redact(ctx.session, ROOM, "$cible");
    expect(ctx.client.redactEvent).toHaveBeenCalledWith(ROOM, "$cible", undefined);
  });

  it("modifiable seulement par l'auteur", () => {
    const mien = fakeEvent("$a", { body: "x" }, "@luca:tacita.test");
    const autre = fakeEvent("$b", { body: "x" }, "@adam:tacita.test");
    expect(canEdit(ctx.session, ROOM, mien as never)).toBe(true);
    expect(canEdit(ctx.session, ROOM, autre as never)).toBe(false);
  });

  it("modifiable seulement si l'utilisateur peut encore poster", () => {
    const muet = fakeSession({ maySendEvent: false });
    const mien = fakeEvent("$a", { body: "x" }, "@luca:tacita.test");
    expect(canEdit(muet.session, ROOM, mien as never)).toBe(false);
  });

  it("supprimable selon les droits de redaction du SDK", () => {
    const event = fakeEvent("$a", { body: "x" }, "@adam:tacita.test");
    expect(canRedact(ctx.session, ROOM, event as never)).toBe(true);
    expect(ctx.room.currentState.maySendRedactionForEvent).toHaveBeenCalled();

    const sansDroit = fakeSession({ mayRedact: false });
    expect(canRedact(sansDroit.session, ROOM, event as never)).toBe(false);
  });
});

describe("REQ-MSG-07 — extraction du texte pour copie", () => {
  it("rend le corps du message", () => {
    expect(messageText(fakeEvent("$a", { body: "salut" }) as never)).toBe("salut");
  });

  it("rend le texte édité plutôt que le fallback étoilé", () => {
    const edited = fakeEvent("$a", {
      body: "* corrigé",
      "m.new_content": { body: "corrigé" },
    });
    expect(messageText(edited as never)).toBe("corrigé");
  });

  it("retire la citation que Matrix préfixe aux réponses", () => {
    const answer = fakeEvent("$a", { body: "> <@adam:tacita.test> question\n\nréponse" });
    expect(messageText(answer as never)).toBe("réponse");
  });

  it("rend une chaîne vide sur un événement sans corps texte", () => {
    expect(messageText(fakeEvent("$a", {}) as never)).toBe("");
  });
});

describe("REQ-MSG-12 — ordre repris de OrderedTimeline, aucun tri propre", () => {
  it("conserve l'ordre de la timeline malgré des timestamps décroissants", () => {
    ctx.setTimeline([
      fakeEvent("$a", { body: "un" }),
      fakeEvent("$reaction", {}, "@luca:tacita.test", "m.reaction"),
      fakeEvent("$b", { body: "deux" }),
    ]);
    expect(messages(ctx.session, ROOM).map((event) => event.getId())).toEqual(["$a", "$b"]);
    expect(ctx.session.timeline).toHaveBeenCalledWith(ROOM);
  });

  it("aucun tri n'est écrit dans le package", () => {
    const code = codeOf("messages.ts", "rooms.ts", "typing.ts", "mentions.ts", "index.ts");
    expect(code).not.toMatch(/\.sort\(|origin_server_ts|getTs\(/);
  });
});
