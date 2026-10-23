"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { signIn, signUp } from "@/lib/auth/client";
import { ROUTES } from "@/lib/ui/routes";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

type FieldErrors = Partial<Record<"name" | "email" | "password", string>>;

interface AuthError {
  code?: string;
  message?: string;
  status?: number;
}

function messageFor(error: AuthError, mode: "login" | "register"): { form?: string; fields?: FieldErrors } {
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return { form: "Incorrect email or password." };
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return { fields: { email: "An account with this email already exists. Log in instead." } };
    case "INVALID_EMAIL":
      return { fields: { email: "Enter a valid email address." } };
    case "PASSWORD_TOO_SHORT":
      return { fields: { password: `Use at least ${MIN_PASSWORD} characters.` } };
    case "PASSWORD_TOO_LONG":
      return { fields: { password: "Use at most 128 characters." } };
  }
  if (error.status === 429) return { form: "Too many attempts. Please wait a minute and try again." };
  return {
    form:
      mode === "login"
        ? "We couldn't log you in. Please try again."
        : "We couldn't create your account. Please try again.",
  };
}

function useAuthSubmit(mode: "login" | "register", next: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  const focusFirstError = (errors: FieldErrors) => {
    const first = (["name", "email", "password"] as const).find((k) => errors[k]);
    if (first) formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    const errors: FieldErrors = {};
    if (mode === "register" && !name) errors.name = "Enter your full name.";
    if (!email) errors.email = "Enter your email address.";
    else if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address, like name@example.com.";
    if (!password) errors.password = "Enter your password.";
    else if (mode === "register" && password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters.`;

    setFieldErrors(errors);
    setFormError(undefined);
    if (Object.keys(errors).length) {
      focusFirstError(errors);
      return;
    }

    startTransition(async () => {
      try {
        const { error } =
          mode === "login" ? await signIn.email({ email, password }) : await signUp.email({ name, email, password });
        if (error) {
          const mapped = messageFor(error, mode);
          setFormError(mapped.form);
          setFieldErrors(mapped.fields ?? {});
          if (mapped.fields) focusFirstError(mapped.fields);
          return;
        }
        router.replace(next);
        router.refresh();
      } catch {
        setFormError("We couldn't reach the server. Check your connection and try again.");
      }
    });
  };

  return { pending, formError, fieldErrors, onSubmit, formRef };
}

export function LoginForm({ next }: { next: string }) {
  const { pending, formError, fieldErrors, onSubmit, formRef } = useAuthSubmit("login", next);
  const registerHref = next !== "/" ? `${ROUTES.register}?next=${encodeURIComponent(next)}` : ROUTES.register;
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-describedby={formError ? "login-error" : undefined} className="flex flex-col gap-5">
      {formError && (
        <div id="login-error">
          <Notice tone="error" live>
            {formError}
          </Notice>
        </div>
      )}
      <TextField id="email" name="email" type="email" label="Email" autoComplete="email" inputMode="email" required error={fieldErrors.email} />
      <TextField
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
        error={fieldErrors.password}
      />
      <Button type="submit" size="lg" fullWidth loading={pending} loadingText="Logging in…">
        Log in
      </Button>
      <p className="text-center text-sm text-ink-muted">
        New to DriveEasy?{" "}
        <Link href={registerHref} className="font-semibold text-brand-700 underline-offset-2 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ next }: { next: string }) {
  const { pending, formError, fieldErrors, onSubmit, formRef } = useAuthSubmit("register", next);
  const loginHref = next !== "/" ? `${ROUTES.login}?next=${encodeURIComponent(next)}` : ROUTES.login;
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-describedby={formError ? "register-error" : undefined} className="flex flex-col gap-5">
      {formError && (
        <div id="register-error">
          <Notice tone="error" live>
            {formError}
          </Notice>
        </div>
      )}
      <TextField id="name" name="name" label="Full name" autoComplete="name" required error={fieldErrors.name} />
      <TextField id="email" name="email" type="email" label="Email" autoComplete="email" inputMode="email" required error={fieldErrors.email} />
      <TextField
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD} characters.`}
        minLength={MIN_PASSWORD}
        maxLength={128}
        required
        error={fieldErrors.password}
      />
      <Button type="submit" size="lg" fullWidth loading={pending} loadingText="Creating account…">
        Create account
      </Button>
      <p className="text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href={loginHref} className="font-semibold text-brand-700 underline-offset-2 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
