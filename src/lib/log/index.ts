// Structured JSON server logs: one line per event with level, msg, time, requestId and context.
// Secrets and personal documents are redacted by key name; never pass card numbers here.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT = /pass(word)?|secret|token|authorization|cookie|signature|licen[cs]e_?(number|file)|card|cvc|api_?key/i;

function minLevel(): number {
  const env = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "warn" : "info")) as LogLevel;
  return ORDER[env] ?? ORDER.info;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, ...(depth === 0 && value.stack ? { stack: value.stack } : {}) };
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return depth > 4 ? "[array]" : value.map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 4) return "[object]";
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, REDACT.test(k) ? "[redacted]" : sanitize(v, depth + 1)]),
    );
  }
  return value;
}

function write(level: LogLevel, msg: string, context: LogContext = {}) {
  if (ORDER[level] < minLevel()) return;
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...(sanitize(context) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export type Logger = {
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  /** A logger that adds `bound` (e.g. { requestId }) to every line. */
  child(bound: LogContext): Logger;
};

function makeLogger(bound: LogContext): Logger {
  return {
    debug: (msg, ctx) => write("debug", msg, { ...bound, ...ctx }),
    info: (msg, ctx) => write("info", msg, { ...bound, ...ctx }),
    warn: (msg, ctx) => write("warn", msg, { ...bound, ...ctx }),
    error: (msg, ctx) => write("error", msg, { ...bound, ...ctx }),
    child: (more) => makeLogger({ ...bound, ...more }),
  };
}

export const log: Logger = makeLogger({});

/** Request id from the platform header (Vercel sets x-vercel-id) or a fresh one. */
export function requestIdFrom(headers: Headers): string {
  return headers.get("x-request-id") ?? headers.get("x-vercel-id") ?? crypto.randomUUID();
}
