"use client";

import { creerCompte, initSession, type Session } from "@tacita/client-core";
import { useState } from "react";

import { IconeCle } from "../foundation/icons";
import { Button, Text, TextInput, VStack } from "../foundation/primitives";

/**
 * REQ-UI-04 / REQ-UIX-06 — **l'écran de connexion**, réécrit le 25/08/2026 (D-12, D-13).
 *
 * Il n'existait pas : la connexion partait chez un fournisseur OIDC externe, et cet
 * écran-ci était une phrase d'attente pendant la redirection. Keycloak supprimé, l'identité
 * est portée par Synapse — le formulaire revient donc dans le produit, et c'est le premier
 * écran que voit quelqu'un qui n'a pas de session.
 *
 * **Un seul écran pour les deux gestes**, pas deux routes. Se connecter et créer un compte
 * demandent les deux mêmes champs ; les séparer aurait fait deux formulaires jumeaux à
 * tenir en phase, et obligé à choisir avant de savoir. La bascule ne perd pas la saisie :
 * quelqu'un qui se trompe de mode a déjà tapé son identifiant.
 *
 * **Deux champs, et deux seulement** (D-13, même jour) : créer un compte demande un
 * identifiant et un mot de passe. Le code d'invitation qu'exigeait la première version a
 * été retiré du serveur, donc de l'écran — ce que ça ouvre est assumé et écrit dans
 * `infra/LIMITES.md`, ce n'est pas au formulaire de le compenser.
 *
 * Ce que cet écran ne fait pas, et qui appartient à la porte : décider de ce qui vient
 * après. Il rend une `Session`, `RecoveryGate` s'occupe du reste (clé, parcours d'accueil).
 */
type Mode = "connexion" | "creation";

/** Ce qui a échoué, dit dans les mots de la personne et non dans ceux du protocole. */
type Echec = "identifiants" | "refus" | "pris" | "reseau";

const MESSAGES: Record<Echec, string> = {
  identifiants: "Identifiant ou mot de passe incorrect.",
  refus: "La création de compte est refusée par ce serveur.",
  pris: "Cet identifiant est déjà pris.",
  reseau: "Le serveur n'a pas répondu. Réessayez.",
};

/**
 * Classe l'échec par **ce que la personne doit faire**, jamais par son code HTTP (règle 2).
 *
 * Le message du serveur n'est jamais affiché : sur ce chemin il peut porter l'identifiant
 * tapé, et un mot de passe faux se dit autrement qu'un identifiant déjà pris — la même
 * phrase pour les deux enverrait corriger le mauvais champ.
 */
function classer(erreur: unknown, mode: Mode): Echec {
  const { errcode } = (erreur ?? {}) as { errcode?: string };
  if (errcode === "M_USER_IN_USE") return "pris";
  /*
   * Le serveur exige une étape d'inscription que le client ne sait pas franchir — un code
   * d'invitation remis par exemple (le repli écrit dans D-13). Il a répondu, et vite :
   * « le serveur n'a pas répondu » enverrait réessayer sans fin. Le message dit donc
   * refus, parce que c'en est un, et parce que rien dans cet écran ne peut le lever.
   */
  if (errcode === "TACITA_INSCRIPTION_IMPOSSIBLE") return "refus";
  if (errcode === "M_FORBIDDEN") return mode === "creation" ? "refus" : "identifiants";
  if (errcode === "M_UNAUTHORIZED" || errcode === "M_INVALID_PARAM") return "identifiants";
  return "reseau";
}

export function Connexion({
  homeserverUrl,
  onSession,
  indexedDB,
}: {
  homeserverUrl: string;
  onSession: (session: Session) => void;
  /** REQ-COR-03 — surchargeable en test ; `globalThis.indexedDB` en navigateur. */
  indexedDB?: IDBFactory;
}) {
  const [mode, setMode] = useState<Mode>("connexion");
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [echec, setEchec] = useState<Echec>();
  const [enCours, setEnCours] = useState(false);

  const creation = mode === "creation";
  const complet = identifiant.trim() !== "" && motDePasse !== "";

  const soumettre = async () => {
    if (!complet || enCours) return;
    setEnCours(true);
    setEchec(undefined);
    try {
      const config = { homeserverUrl, identifiant: identifiant.trim(), motDePasse, indexedDB };
      onSession(creation ? await creerCompte(config) : await initSession(config));
    } catch (erreur) {
      // Rien n'est journalisé : le mot de passe est dans la portée de ce bloc.
      setEchec(classer(erreur, mode));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <VStack style={{ gap: "var(--spacing-12)" }}>
      <VStack hAlign="center">
        <div
          aria-hidden
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 88,
            height: 88,
            borderRadius: "var(--radius-full)",
            backgroundColor: "var(--color-accent-muted)",
            color: "var(--color-accent)",
          }}
        >
          {IconeCle}
        </div>
      </VStack>

      <VStack gap={8}>
        <VStack gap={5}>
          <Text type="display-3" as="h1" style={{ textWrap: "balance" }}>
            {creation ? "Créez votre compte" : "Connectez-vous"}
          </Text>
          <Text style={{ textWrap: "pretty" }}>
            {creation
              ? "Choisissez un identifiant et un mot de passe. Rien d'autre n'est demandé : ni e-mail, ni code d'invitation."
              : "Votre identifiant est celui que vous avez choisi à la création du compte."}
          </Text>
        </VStack>

        <VStack gap={4}>
          {/*
            Mêmes garde-fous de clavier que l'écran de clé, et portés par le parent pour la
            même raison (jurisprudence E-10, on ne recode pas une primitive). Un identifiant
            Matrix est en minuscules : une majuscule posée par un clavier mobile donne un
            compte introuvable, sans que personne ne voie ce qui a changé.
          */}
          <div autoCapitalize="none" autoCorrect="off" spellCheck={false}>
            <TextInput
              label="Identifiant"
              value={identifiant}
              onChange={(v) => {
                setIdentifiant(v);
                setEchec(undefined);
              }}
              onEnter={() => void soumettre()}
              placeholder="adam"
              hasAutoFocus
              width="100%"
              status={
                echec === "pris" ? { type: "error", message: MESSAGES.pris } : undefined
              }
            />
          </div>

          <TextInput
            label="Mot de passe"
            type="password"
            value={motDePasse}
            onChange={(v) => {
              setMotDePasse(v);
              setEchec(undefined);
            }}
            onEnter={() => void soumettre()}
            width="100%"
            status={
              echec === "identifiants"
                ? { type: "error", message: MESSAGES.identifiants }
                : undefined
            }
          />

          {/*
            D-13 — il n'y a pas de troisième champ. Le code d'invitation vivait ici ; le
            serveur ne l'exige plus (`registration_requires_token` retiré), et un champ
            qui n'est plus lu est pire qu'absent : il fait chercher un code à quelqu'un
            qui n'en a pas besoin.
          */}
          {(echec === "reseau" || echec === "refus") && (
            <Text type="supporting" style={{ color: "var(--color-danger)" }}>
              {MESSAGES[echec]}
            </Text>
          )}

          <Button
            label={creation ? "Créer mon compte" : "Se connecter"}
            variant="primary"
            isLoading={enCours}
            isDisabled={!complet}
            onClick={() => void soumettre()}
          />

          {/*
            La bascule est en `ghost` sous l'action : un seul aplat plein par vue, comme
            partout ailleurs dans ce parcours. Elle ne vide pas les champs — se tromper de
            mode ne doit pas coûter la saisie déjà faite.
          */}
          <VStack hAlign="center">
            <Button
              label={creation ? "J'ai déjà un compte" : "Créer un compte"}
              variant="ghost"
              onClick={() => {
                setMode(creation ? "connexion" : "creation");
                setEchec(undefined);
              }}
            />
          </VStack>
        </VStack>
      </VStack>
    </VStack>
  );
}
