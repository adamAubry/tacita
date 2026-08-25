export {
  changerMotDePasse,
  connexionParCle,
  creerCompte,
  initSession,
  onSessionInvalidee,
  restoreSession,
} from "./session";
export { LONGUEUR_MINIMALE_MOT_DE_PASSE } from "./session";
export type {
  Appareil,
  OrderedTimeline,
  RecoveryKey,
  RecoveryState,
  Session,
  SessionConfig,
  SetupRecoveryOptions,
} from "./session";

export { createLogger, eventRef } from "./logger";
export type { Logger, LogFields } from "./logger";
