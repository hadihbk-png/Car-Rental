import "server-only";
import { isDomainError } from "@/lib/errors";
import type { ActionState } from "./action-state";

/** Removes a "field.path: " prefix that service validation messages may carry. */
export function cleanMessage(message: string): string {
  return message.replace(/^[A-Za-z_.]+:\s*/, "");
}

/** Converts an expected DomainError into an error state; anything else is rethrown (reaches error.tsx). */
export function toErrorState(error: unknown): ActionState {
  if (isDomainError(error)) {
    return { status: "error", message: cleanMessage(error.message), code: error.code, fieldErrors: error.fieldErrors };
  }
  throw error;
}

export function formString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** File from a form, or null when no file was chosen. */
export function formFile(formData: FormData, key: string): File | null {
  const v = formData.get(key);
  return v instanceof File && v.size > 0 ? v : null;
}
