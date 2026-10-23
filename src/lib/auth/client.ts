// Browser auth client for the App Agent: signIn.email, signUp.email, signOut, useSession.
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // Same-origin by default; the API lives at /api/auth/*.
});

export const { signIn, signUp, signOut, useSession } = authClient;
