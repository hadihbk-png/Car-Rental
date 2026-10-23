import "server-only";
import { parseMoneyInput } from "@/lib/ui/money";
import type { ActionState } from "@/app/_lib/action-state";

/** Reads and validates admin form fields, collecting field errors keyed like the service schemas. */
export class FormReader {
  readonly errors: Record<string, string[]> = {};
  constructor(private readonly fd: FormData) {}

  private raw(key: string): string {
    const v = this.fd.get(key);
    return typeof v === "string" ? v.trim() : "";
  }
  private fail(key: string, message: string) {
    (this.errors[key] ??= []).push(message);
  }

  str(key: string): string {
    return this.raw(key);
  }
  /** Empty -> null (for nullish service fields). */
  optStr(key: string): string | null {
    return this.raw(key) || null;
  }
  int(key: string, label = "This field"): number {
    const v = this.raw(key);
    if (!/^-?\d+$/.test(v)) {
      this.fail(key, `${label} must be a whole number.`);
      return 0;
    }
    return Number(v);
  }
  optInt(key: string, label = "This field"): number | null {
    return this.raw(key) === "" ? null : this.int(key, label);
  }
  /** AED amount typed by the admin -> integer fils. */
  money(key: string): number {
    const fils = parseMoneyInput(this.raw(key));
    if (fils === null) {
      this.fail(key, "Enter an amount in AED, e.g. 150 or 99.50.");
      return 0;
    }
    return fils;
  }
  optMoney(key: string): number | null {
    return this.raw(key) === "" ? null : this.money(key);
  }
  optNumber(key: string, label = "This field"): number | null {
    const v = this.raw(key);
    if (v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      this.fail(key, `${label} must be a number.`);
      return null;
    }
    return n;
  }
  bool(key: string): boolean {
    return this.fd.get(key) === "on" || this.fd.get(key) === "true";
  }
  all(key: string): string[] {
    return this.fd.getAll(key).filter((v): v is string => typeof v === "string" && v !== "");
  }

  /** An error state when any field failed to parse, otherwise null. */
  invalid(): ActionState | null {
    return Object.keys(this.errors).length
      ? { status: "error", message: "Please correct the highlighted fields.", fieldErrors: this.errors }
      : null;
  }
}
