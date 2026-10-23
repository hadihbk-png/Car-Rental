import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/ui/routes";
import { Card } from "@/components/ui/card";
import { AuthFormSkeleton } from "../auth-skeleton";
import { RegisterForm } from "../auth-forms";

export const metadata: Metadata = { title: "Create account" };

async function RegisterGate({ searchParams }: { searchParams: PageProps<"/register">["searchParams"] }) {
  const next = safeNextPath((await searchParams).next);
  if (await getSession()) redirect(next);
  return <RegisterForm next={next} />;
}

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return (
    <Card padded>
      <h1 className="text-2xl font-extrabold text-ink">Create your account</h1>
      <p className="mt-1 mb-6 text-sm text-ink-muted">It takes a minute. You&apos;ll add your driving licence before your first rental.</p>
      <Suspense fallback={<AuthFormSkeleton fields={3} />}>
        <RegisterGate searchParams={searchParams} />
      </Suspense>
    </Card>
  );
}
