/**
 * aucun contenu déchiffré dans les logs, la télémétrie ou les traces
 * d'erreur du module, y compris en dev.
 *
 * Le filtre est structurel, pas discipliné : `LogFields` n'accepte que des
 * primitives au type-check, et `sanitize` retire au runtime (a) toute valeur non
 * primitive — un `MatrixEvent`, un `content`, un objet quelconque ne peut donc pas
 * être sérialisé — et (b) toute clé qui désigne un corps d'événement, même si sa
 * valeur est une chaîne.
 *
 * Pour référencer un événement dans un log, `eventRef` est le seul accès autorisé :
 * il ne rend que des métadonnées.
 */

export type LogValue = string | number | boolean | null;
export type LogFields = Record<string, LogValue>;
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSink = (level: LogLevel, message: string, fields: LogFields) => void;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** Clés dont la valeur est, par convention Matrix, un corps d'événement en clair. */
const CONTENT_KEYS = new Set([
  "body",
  "content",
  "formatted_body",
  "formattedBody",
  "plaintext",
  "clearContent",
  "clear_content",
  "decrypted",
  "text",
  "topic",
]);

const isLogValue = (value: unknown): value is LogValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

export function sanitize(fields: Record<string, unknown>): LogFields {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (CONTENT_KEYS.has(key)) continue;
    if (isLogValue(value)) safe[key] = value;
  }
  return safe;
}

/** Métadonnées d'un événement : identifiants et type, jamais le corps. */
export function eventRef(event: {
  getId(): string | undefined;
  getRoomId(): string | undefined;
  getType(): string;
}): LogFields {
  return {
    eventId: event.getId() ?? null,
    roomId: event.getRoomId() ?? null,
    eventType: event.getType(),
  };
}

const consoleSink: LogSink = (level, message, fields) => {
  console[level](`[client-core] ${message}`, fields);
};

export function createLogger(sink: LogSink = consoleSink): Logger {
  const at =
    (level: LogLevel) =>
    (message: string, fields: LogFields = {}): void =>
      sink(level, message, sanitize(fields));
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}
