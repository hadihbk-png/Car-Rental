import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { AlertCircleIcon } from "./icons";
import { Input, Select, Textarea, type InputProps, type SelectProps, type TextareaProps } from "./form-controls";

/** ids for aria-describedby: `${id}-hint` and `${id}-error`. */
export function describedBy(id: string, opts: { hint?: unknown; error?: unknown }): string | undefined {
  const ids = [opts.hint ? `${id}-hint` : null, opts.error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

export interface FieldProps {
  /** id of the control inside; the label points at it. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  /** Validation message; rendered with role="alert"-free live text under the control. */
  error?: string;
  required?: boolean;
  /** Text after the label for optional fields. */
  optionalLabel?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Label + control + hint + error. The control must use the same `id` and
 * `aria-describedby={describedBy(id, { hint, error })}`; TextField/SelectField/TextareaField do this for you.
 */
export function Field({ id, label, hint, error, required, optionalLabel, className, children }: FieldProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
        {required && (
          <span className="ml-0.5 text-red-700" aria-hidden="true">
            *
          </span>
        )}
        {optionalLabel && <span className="ml-1.5 font-normal text-ink-muted">(optional)</span>}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-sm font-medium text-red-700">
          <AlertCircleIcon size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

type FieldBits = Pick<FieldProps, "label" | "hint" | "error" | "optionalLabel"> & { id: string; fieldClassName?: string };

export type TextFieldProps = FieldBits & Omit<InputProps, "id" | "invalid">;
export function TextField({ id, label, hint, error, optionalLabel, fieldClassName, required, ...props }: TextFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} optionalLabel={optionalLabel} className={fieldClassName}>
      <Input id={id} required={required} invalid={Boolean(error)} aria-describedby={describedBy(id, { hint, error })} {...props} />
    </Field>
  );
}

export type TextareaFieldProps = FieldBits & Omit<TextareaProps, "id" | "invalid">;
export function TextareaField({ id, label, hint, error, optionalLabel, fieldClassName, required, ...props }: TextareaFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} optionalLabel={optionalLabel} className={fieldClassName}>
      <Textarea id={id} required={required} invalid={Boolean(error)} aria-describedby={describedBy(id, { hint, error })} {...props} />
    </Field>
  );
}

export type SelectFieldProps = FieldBits & Omit<SelectProps, "id" | "invalid">;
export function SelectField({ id, label, hint, error, optionalLabel, fieldClassName, required, ...props }: SelectFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} optionalLabel={optionalLabel} className={fieldClassName}>
      <Select id={id} required={required} invalid={Boolean(error)} aria-describedby={describedBy(id, { hint, error })} {...props} />
    </Field>
  );
}

/** Form-level error summary, shown at the top of a form after a failed submit. */
export function FormErrorSummary({ title = "Please fix the following", errors }: { title?: string; errors: { id: string; message: string }[] }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <p className="font-semibold">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {errors.map((e) => (
          <li key={e.id}>
            <a href={`#${e.id}`} className="underline underline-offset-2 hover:no-underline">
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
