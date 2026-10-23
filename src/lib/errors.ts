// Typed errors thrown by domain services. Safe to show `message` to the user;
// `httpStatus` lets route handlers and server actions map them consistently.

export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "VEHICLE_UNAVAILABLE"
  | "INVALID_STATE"
  | "POLICY_VIOLATION"
  | "PAYMENT_FAILED"
  | "NO_PRICE";

const STATUS: Record<DomainErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  VEHICLE_UNAVAILABLE: 409,
  INVALID_STATE: 409,
  POLICY_VIOLATION: 422,
  PAYMENT_FAILED: 402,
  NO_PRICE: 422,
};

export class DomainError extends Error {
  readonly httpStatus: number;
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    /** Field-level problems for VALIDATION errors: { "pickupAt": ["must be in the future"] }. */
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "DomainError";
    this.httpStatus = STATUS[code];
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}

/** Postgres error helpers (node-postgres puts SQLSTATE in `code`). Drizzle wraps errors in `cause`. */
export function pgErrorOf(err: unknown): { code?: string; constraint?: string } | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const o = e as { code?: unknown; constraint?: string; cause?: unknown };
    if (typeof o.code === "string" && /^[0-9A-Z]{5}$/.test(o.code)) return { code: o.code, constraint: o.constraint };
    e = o.cause;
  }
  return undefined;
}

export const isExclusionViolation = (err: unknown) => pgErrorOf(err)?.code === "23P01";
export const isUniqueViolation = (err: unknown, constraint?: string) => {
  const pg = pgErrorOf(err);
  return pg?.code === "23505" && (!constraint || pg.constraint === constraint);
};
