import type { IntlShape } from "react-intl";

export type ErrorParams = Record<string, string | number>;

/**
 * Error carrying a stable code that maps to an `errors.<code>` locale key.
 * Anything user-visible must travel as a code (params allowed); raw english
 * detail stays in `message` for the console.
 */
export class DiError extends Error {
  readonly code: string;
  readonly params: ErrorParams | undefined;
  constructor(code: string, params?: ErrorParams, message?: string) {
    super(message ?? code);
    this.name = "DiError";
    this.code = code;
    this.params = params;
  }
}

/** Extract the DiError code from any thrown value. */
export function errorCode(err: unknown): string | undefined {
  return err instanceof DiError ? err.code : undefined;
}

function hasKey(intl: IntlShape, id: string): boolean {
  return id in intl.messages;
}

/** Localized rendering of a thrown value: `errors.<code>`, else `errors.unknown`. */
export function errorMessage(intl: IntlShape, err: unknown): string {
  if (err instanceof DiError) {
    const id = `errors.${err.code}`;
    if (hasKey(intl, id)) return intl.formatMessage({ id }, err.params);
  }
  return intl.formatMessage({ id: "errors.unknown" });
}

/** Localized rendering of a bare code string (the voice driver's onError channel). */
export function codeMessage(intl: IntlShape, code: string | null | undefined): string {
  if (code) {
    const id = `errors.${code}`;
    if (hasKey(intl, id)) return intl.formatMessage({ id });
  }
  return intl.formatMessage({ id: "errors.unknown" });
}

/**
 * errorMessage with a diagnostic fallback: coded errors localize, everything
 * else keeps its raw detail (endpoint/network errors are third-party text).
 */
export function errorDetail(intl: IntlShape, err: unknown): string {
  if (err instanceof DiError) return errorMessage(intl, err);
  if (err instanceof Error) return err.message;
  return String(err);
}
