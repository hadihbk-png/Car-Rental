/** Client-safe result shape returned by server actions used with useActionState. */
export type ActionState =
  | { status: "idle" }
  | { status: "ok"; message?: string }
  | { status: "error"; message: string; code?: string; fieldErrors?: Record<string, string[]> };

export const IDLE: ActionState = { status: "idle" };

/** First error message for a field, or undefined. */
export function fieldError(state: ActionState, ...keys: string[]): string | undefined {
  if (state.status !== "error" || !state.fieldErrors) return undefined;
  for (const key of keys) {
    const msg = state.fieldErrors[key]?.[0];
    if (msg) return msg;
  }
  return undefined;
}
