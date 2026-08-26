import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const racine = new URL("../../../", import.meta.url);

describe("l'ajout par identifiant ne passe pas par ce service", () => {
  /**
   * Ce qui doit rester vrai : **un seul module hors de ce dossier connaît ce service**,
   * et c'est le client de liens du shard. Le reste du dépôt l'ignore, ce qui garantit
   * que l'ajout par identifiant (natif, D-09) ne peut pas dépendre de lui.
   *
   * La borne était « aucun » jusqu'au 07/08/2026 — elle fermait la porte au client de
   * réception qu'E-13 exige (voie A : résoudre, puis frapper). Elle devient « un seul,
   * nommé ». Un second appelant échoue ici, ce qui est le point : c'est la frontière du
   * service, pas une interdiction de l'utiliser.
   */
  const CLIENT_AUTORISE = "/apps/web/lib/liens-invitation.ts";
  const sources = (): { chemin: string; code: string }[] => {
    const fichiers: { chemin: string; code: string }[] = [];
    const parcourir = (dossier: URL) => {
      for (const entrée of readdirSync(dossier, { withFileTypes: true })) {
        if (entrée.name === "node_modules" || entrée.name.startsWith(".")) continue;
        const chemin = new URL(`${entrée.name}${entrée.isDirectory() ? "/" : ""}`, dossier);
        if (entrée.isDirectory()) parcourir(chemin);
        else if (/\.tsx?$/.test(entrée.name)) {
          fichiers.push({ chemin: chemin.pathname, code: readFileSync(chemin, "utf-8") });
        }
      }
    };
    for (const racineRelative of ["packages/", "apps/"]) {
      parcourir(new URL(racineRelative, racine));
    }
    return fichiers;
  };

  it("aucun paquet ni autre app n'appelle les routes du service", () => {
    const autres = sources().filter(
      ({ chemin }) => !chemin.includes("/apps/invite-tokens/") && !chemin.endsWith(CLIENT_AUTORISE),
    );

    expect(autres.length).toBeGreaterThan(10); // le balayage trouve bien du code
    for (const { chemin, code } of autres) {
      expect(code, chemin).not.toMatch(/\/links\/[^/\s]*\/resolve|INVITE_SERVICE_URL|invite-tokens/);
    }
  });
  it("le client autorisé existe : la porte est nommée, pas simplement ouverte", () => {
    // Sans cette assertion, renommer le fichier désactiverait le balayage en silence —
    // l'exception ne correspondrait plus à rien et tout redeviendrait « conforme ».
    const client = sources().find(({ chemin }) => chemin.endsWith(CLIENT_AUTORISE));
    expect(client, `${CLIENT_AUTORISE} introuvable`).toBeTruthy();
    expect(client!.code).toContain("/resolve");
  });
});
