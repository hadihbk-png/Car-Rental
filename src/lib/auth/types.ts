// Client-safe types shared by server helpers and the UI.
export type Role = "customer" | "admin";

/** The signed-in user as seen by domain services. */
export type Actor = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export const isAdmin = (actor: Pick<Actor, "role"> | null | undefined) => actor?.role === "admin";
