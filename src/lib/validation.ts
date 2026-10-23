import { z } from "zod";
import { DomainError } from "@/lib/errors";

/** Parses service input; throws DomainError("VALIDATION") with field errors on failure. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  const first = result.error.issues[0];
  throw new DomainError(
    "VALIDATION",
    first ? `${first.path.length ? first.path.join(".") + ": " : ""}${first.message}` : "Invalid input",
    fieldErrors,
  );
}

export const zId = z.uuid({ message: "Invalid id" });
/** Accepts Date objects and ISO strings (server actions often pass strings). */
export const zInstant = z.coerce.date({ message: "Invalid date/time" }).refine((d) => !Number.isNaN(d.getTime()), {
  message: "Invalid date/time",
});
export const zFils = z.number().int().min(0).max(1_000_000_000);
export const zLocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
