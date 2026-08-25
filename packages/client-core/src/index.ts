export {
  changerMotDePasse,
  creerCompte,
  initSession,
  onSessionInvalidee,
  restoreSession,
} from "./session";
export type {
  OrderedTimeline,
  RecoveryKey,
  RecoveryState,
  Session,
  SessionConfig,
  SetupRecoveryOptions,
} from "./session";

export { createLogger, eventRef } from "./logger";
export type { Logger, LogFields } from "./logger";
