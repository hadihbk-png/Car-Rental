// Test stand-in for the `server-only` package. Next.js turns importing it
// from client code into a build error; under Vitest every module is "server",
// so the import is a no-op.
export {};
