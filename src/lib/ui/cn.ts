/** Joins class-name strings, skipping falsy/non-string values (so `cond && "x"` works for any cond type). */
export function cn(...parts: unknown[]): string {
  let out = "";
  for (const part of parts) {
    if (typeof part === "string" && part) out = out ? `${out} ${part}` : part;
  }
  return out;
}
