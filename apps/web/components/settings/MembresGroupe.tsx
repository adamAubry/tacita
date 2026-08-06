"use client";

import type { Session } from "@tacita/client-core";
import { canKick, kick, members, powerLevelOf } from "@tacita/messaging";
import { useMemo, useState } from "react";

import { ConversationAvatar } from "../foundation/ConversationAvatar";
import { Button, List, ListItem, Text } from "../foundation/primitives";

export interface MembresGroupeProps {
  session: Session;
  roomId: string;
}

/**
 * REQ-UIX-34 / REQ-MSG-11 — la liste des membres d'un groupe, avec l'exclusion **là où
 * elle est permise**.
 *
 * « Les boutons non autorisés n'apparaissent pas » (M-H) : pas d'item grisé, pas de
 * tooltip d'excuse. Un bouton visible qu'on ne peut pas actionner apprend à ignorer les
 * boutons. Le droit vient du paquet (`canKick`), qui croise le seuil du salon et les
 * deux power levels — le shard ne le recalcule pas.
 *
 * Le power level est affiché **en nombre**, tel que Matrix le porte : la spec 05 refuse
 * les rôles nommés, et inventer « modérateur » à l'affichage serait la même invention un
 * cran plus bas.
 */
export function MembresGroupe({ session, roomId }: MembresGroupeProps) {
  const [version, setVersion] = useState(0);
  const [echec, setEchec] = useState<string | undefined>();

  // `version` est la dépendance qui compte : le paquet rend une vue de l'état du salon,
  // et c'est l'exclusion qui dit qu'elle a changé (même motif qu'en M-D).
  const liste = useMemo(() => members(session, roomId), [session, roomId, version]);

  return (
    <div style={{ display: "grid", gap: "var(--spacing-2)", padding: "var(--spacing-3)" }}>
      <Text type="supporting" color="secondary" hasTabularNumbers>
        {liste.length} membres
      </Text>

      <List>
        {liste.map((membre) => {
          const niveau = powerLevelOf(session, roomId, membre.userId);
          return (
            <ListItem
              key={membre.userId}
              label={membre.name || membre.userId}
              description={niveau > 0 ? `${membre.userId} · niveau ${niveau}` : membre.userId}
              startContent={<ConversationAvatar nom={membre.name || membre.userId} direct taille={36} />}
              endContent={
                canKick(session, roomId, membre.userId) ? (
                  <Button
                    label="Exclure"
                    variant="ghost"
                    onClick={() => {
                      setEchec(undefined);
                      void kick(session, roomId, membre.userId)
                        .then(() => setVersion((tour) => tour + 1))
                        .catch(() =>
                          setEchec(
                            "L'exclusion a été refusée. Vos droits ont peut-être changé depuis l'ouverture de cet écran.",
                          ),
                        );
                    }}
                  />
                ) : undefined
              }
              style={{ minHeight: 44 }}
            />
          );
        })}
      </List>

      {echec && (
        <Text type="supporting" color="secondary">
          {echec}
        </Text>
      )}
    </div>
  );
}
