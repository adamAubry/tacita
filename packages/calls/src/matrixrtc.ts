/**
 * REQ-CAL-04 — **le seul fichier du client portant des littéraux MatrixRTC.** Un test
 * structurel échoue si l'un d'eux réapparaît ailleurs dans `src/`.
 *
 * Les MSC MatrixRTC ne sont pas stabilisés : ces valeurs ne se recopient pas de mémoire,
 * elles se relisent. Vérifiées le **2026-08-03** contre :
 *
 * - `matrix-js-sdk@42.0.0`, la version déployée — `lib/matrixrtc/MembershipManager.js`
 *   (type d'événement et fabrique de state key) et `lib/@types/event.d.ts`
 *   (`GroupCallMemberPrefix`) ;
 * - `infra/rtc/README.md` (REQ-RTC-07) et `infra/rtc/well-known.conf`, pour la clé de
 *   découverte des foci et les champs du focus LiveKit.
 *
 * ⚠️ Divergence connue, à surveiller : le brouillon courant de MSC4143 remplace ces
 * événements d'état `org.matrix.msc3401.call.member` par des événements *sticky*
 * `m.rtc.member` (MSC4354). Element Call et le SDK sont encore sur le préfixe msc3401.
 * Le jour où le SDK bascule, tout se change ici — et nulle part ailleurs.
 */

/** Clé de découverte des foci dans `.well-known/matrix/client` (MSC4143). */
export const RTC_FOCI_WELL_KNOWN_KEY = "org.matrix.msc4143.rtc_foci";

/** Événement d'état d'appartenance à un appel (MSC3401, préfixe non stabilisé). */
export const CALL_MEMBER_EVENT_TYPE = "org.matrix.msc3401.call.member";

/** Champs du focus LiveKit (MSC4195), tels que servis par le `.well-known` du proxy. */
export const LIVEKIT_FOCUS_TYPE = "livekit";
export const LIVEKIT_SERVICE_URL_FIELD = "livekit_service_url";

/** Application MatrixRTC d'un appel de salon. */
export const CALL_APPLICATION = "m.call";

/** Durée de validité par défaut d'une appartenance, faute de `expires` dans le contenu. */
export const DEFAULT_MEMBERSHIP_EXPIRY_MS = 4 * 60 * 60 * 1000;

/**
 * State key d'appartenance : `_{userId}_{deviceId}_{application}`. Le préfixe `_` est
 * ce qui rend la clé acceptable par un serveur qui n'autorise pas encore les state keys
 * possédées par l'utilisateur (MSC3757/3779) — le SDK le retire sur les versions de
 * salon qui les supportent. L'identifiant de créneau est vide pour un appel de salon.
 */
export const callMemberStateKey = (userId: string, deviceId: string): string =>
  `_${userId}_${deviceId}_${CALL_APPLICATION}`;

export interface LivekitFocus {
  type: typeof LIVEKIT_FOCUS_TYPE;
  [LIVEKIT_SERVICE_URL_FIELD]: string;
}

export const isLivekitFocus = (value: unknown): value is LivekitFocus =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === LIVEKIT_FOCUS_TYPE &&
  typeof (value as Record<string, unknown>)[LIVEKIT_SERVICE_URL_FIELD] === "string";

/**
 * Une appartenance vidée (`{}`) signale un départ : c'est ainsi que le SDK quitte un
 * appel. Une appartenance périmée signale un client parti sans nettoyer — sans ce
 * filtre, un salon reste indéfiniment « appel en cours ».
 */
export function isLiveMembership(content: Record<string, unknown>, createdTs: number): boolean {
  if (Object.keys(content).length === 0) return false;
  const expires = typeof content.expires === "number" ? content.expires : undefined;
  const created = typeof content.created_ts === "number" ? content.created_ts : createdTs;
  return created + (expires ?? DEFAULT_MEMBERSHIP_EXPIRY_MS) > Date.now();
}
