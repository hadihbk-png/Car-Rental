"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { IDLE, fieldError, type ActionState } from "@/app/_lib/action-state";
import { FileDropzone, type FileDropzoneProps } from "@/components/forms/file-dropzone";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { SelectField, TextField, TextareaField, type SelectFieldProps, type TextFieldProps, type TextareaFieldProps } from "@/components/ui/field";
import { Checkbox, type CheckboxProps } from "@/components/ui/form-controls";
import { Notice } from "@/components/ui/notice";

type ServerAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

interface FormCtx {
  state: ActionState;
  pending: boolean;
  prefix: string;
  /** Increments after each successful submit (used to clear file inputs). */
  version: number;
}
const Ctx = createContext<FormCtx>({ state: IDLE, pending: false, prefix: "", version: 0 });

export interface ActionFormProps {
  action: ServerAction;
  submitLabel: string;
  pendingLabel?: string;
  submitVariant?: ButtonVariant;
  /** Prefix for field ids when several forms share a page. */
  idPrefix?: string;
  /** Reset the inputs after a successful submit (create forms). */
  resetOnSuccess?: boolean;
  /** Ask the browser to confirm before submitting (destructive actions). */
  confirmMessage?: string;
  /** Extra buttons next to submit. */
  secondary?: ReactNode;
  className?: string;
  fieldsClassName?: string;
  children?: ReactNode;
}

/** Server-action form with built-in error/success notice and field error wiring (see F* fields). */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  submitVariant = "primary",
  idPrefix = "",
  resetOnSuccess = false,
  confirmMessage,
  secondary,
  className,
  fieldsClassName,
  children,
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const ref = useRef<HTMLFormElement>(null);
  const [seen, setSeen] = useState(state);
  const [version, setVersion] = useState(0);
  if (seen !== state) {
    setSeen(state);
    if (state.status === "ok") setVersion((v) => v + 1);
  }
  useEffect(() => {
    if (resetOnSuccess && state.status === "ok") ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <Ctx.Provider value={{ state, pending, prefix: idPrefix, version }}>
      <form
        ref={ref}
        action={formAction}
        noValidate
        className={cn("flex flex-col gap-5", className)}
        onSubmit={(e) => {
          if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
        }}
      >
        {state.status === "error" && (
          <Notice tone="error" live>
            {state.message}
          </Notice>
        )}
        {state.status === "ok" && state.message && (
          <Notice tone="success" live>
            {state.message}
          </Notice>
        )}
        {children && <div className={cn("grid gap-5", fieldsClassName)}>{children}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant={submitVariant} loading={pending} loadingText={pendingLabel ?? "Saving…"}>
            {submitLabel}
          </Button>
          {secondary}
        </div>
      </form>
    </Ctx.Provider>
  );
}

function useField(name: string, errorKeys: string[] = []) {
  const { state, prefix } = useContext(Ctx);
  return { id: `${prefix}${name}`, error: fieldError(state, name, ...errorKeys) };
}

type FBase = { name: string; errorKeys?: string[] };

export function FText({ name, errorKeys, ...props }: FBase & Omit<TextFieldProps, "id" | "name" | "error">) {
  const f = useField(name, errorKeys);
  return <TextField id={f.id} name={name} error={f.error} {...props} />;
}

export function FMoney({ name, errorKeys, ...props }: FBase & Omit<TextFieldProps, "id" | "name" | "error" | "inputMode" | "trailing">) {
  const f = useField(name, errorKeys);
  return <TextField id={f.id} name={name} error={f.error} inputMode="decimal" trailing="AED" autoComplete="off" {...props} />;
}

export function FTextarea({ name, errorKeys, ...props }: FBase & Omit<TextareaFieldProps, "id" | "name" | "error">) {
  const f = useField(name, errorKeys);
  return <TextareaField id={f.id} name={name} error={f.error} {...props} />;
}

export function FSelect({ name, errorKeys, ...props }: FBase & Omit<SelectFieldProps, "id" | "name" | "error">) {
  const f = useField(name, errorKeys);
  return <SelectField id={f.id} name={name} error={f.error} {...props} />;
}

export function FCheckbox({ name, errorKeys, ...props }: FBase & Omit<CheckboxProps, "id" | "name">) {
  const f = useField(name, errorKeys);
  return (
    <div>
      <Checkbox id={props.value !== undefined ? `${f.id}-${String(props.value)}` : f.id} name={name} invalid={Boolean(f.error)} {...props} />
      {f.error && <p className="text-sm font-medium text-red-700">{f.error}</p>}
    </div>
  );
}

export function FFile({ name, errorKeys, ...props }: FBase & Omit<FileDropzoneProps, "name" | "error">) {
  const { version } = useContext(Ctx);
  const f = useField(name, errorKeys);
  // Remount after each success so the chosen file is cleared.
  return <FileDropzone key={version} name={name} error={f.error} {...props} />;
}
