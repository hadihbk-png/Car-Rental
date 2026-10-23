import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/ui/routes";
import { Card } from "@/components/ui/card";
import { AuthFormSkeleton } from "../auth-skeleton";
import { LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "Log in" };

async function LoginGate({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const next = safeNextPath((await searchParams).next);
  if (await getSession()) redirect(next);
  return <LoginForm next={next} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Card padded>
      <h1 className="text-2xl font-extrabold text-ink">Log in</h1>
      <p className="mt-1 mb-6 text-sm text-ink-muted">Welcome back. Log in to book and manage your rentals.</p>
      <Suspense fallback={<AuthFormSkeleton fields={2} />}>
        <LoginGate searchParams={searchParams} />
      </Suspense>
    </Card>
  );
}
