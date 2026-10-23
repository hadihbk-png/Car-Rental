import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";
import { ChevronDownIcon } from "./icons";

const control =
  "block w-full rounded-lg border bg-surface text-ink placeholder:text-ink-subtle shadow-xs " +
  "transition-colors duration-150 focus:outline-none focus-visible:outline-none " +
  "focus:border-brand-600 focus:ring-3 focus:ring-brand-600/25 " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-subtle";

const borderFor = (invalid?: boolean) =>
  invalid ? "border-red-600 focus:border-red-600 focus:ring-red-600/25" : "border-line-strong hover:border-ink-subtle";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  invalid?: boolean;
  /** Icon or text shown inside the left edge (decorative). */
  leading?: ReactNode;
  /** Text shown inside the right edge, e.g. "AED". */
  trailing?: ReactNode;
}

export function Input({ invalid, leading, trailing, className, ...props }: InputProps) {
  const input = (
    <input
      aria-invalid={invalid || undefined}
      className={cn(control, borderFor(invalid), "h-11 px-3 text-base sm:text-sm", leading && "pl-10", trailing && "pr-14", className)}
      {...props}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className="relative">
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-subtle" aria-hidden="true">
          {leading}
        </span>
      )}
      {input}
      {trailing && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-ink-muted" aria-hidden="true">
          {trailing}
        </span>
      )}
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(control, borderFor(invalid), "px-3 py-2.5 text-base sm:text-sm", className)}
      {...props}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  invalid?: boolean;
  options?: readonly SelectOption[];
  /** Adds an empty first option with this label (e.g. "Choose a branch"). */
  placeholder?: string;
  leading?: ReactNode;
}

/** Native select: best keyboard, screen-reader and mobile support. */
export function Select({ invalid, options, placeholder, leading, className, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-subtle" aria-hidden="true">
          {leading}
        </span>
      )}
      <select
        aria-invalid={invalid || undefined}
        className={cn(control, borderFor(invalid), "h-11 appearance-none pr-10 pl-3 text-base sm:text-sm", leading && "pl-10", className)}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-subtle" size={18} />
    </div>
  );
}

interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: ReactNode;
  description?: ReactNode;
  invalid?: boolean;
}

function Choice({ type, label, description, invalid, className, id, ...props }: ChoiceProps & { type: "checkbox" | "radio" }) {
  const descId = description && id ? `${id}-desc` : undefined;
  return (
    <label
      htmlFor={id}
      className={cn(
        "group flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-ink has-disabled:cursor-not-allowed has-disabled:opacity-60",
        className,
      )}
    >
      <input
        id={id}
        type={type}
        aria-invalid={invalid || undefined}
        aria-describedby={descId}
        className={cn(
          "mt-0.5 size-5 shrink-0 cursor-pointer border-line-strong accent-brand-700 disabled:cursor-not-allowed",
          type === "checkbox" ? "rounded" : "rounded-full",
          invalid && "outline-2 outline-red-600",
        )}
        {...props}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {description && (
          <span id={descId} className="text-ink-muted">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

export type CheckboxProps = ChoiceProps;
export function Checkbox(props: CheckboxProps) {
  return <Choice type="checkbox" {...props} />;
}

export type RadioProps = ChoiceProps;
export function Radio(props: RadioProps) {
  return <Choice type="radio" {...props} />;
}

export interface ChoiceGroupProps {
  legend: ReactNode;
  /** Visually hide the legend (still read by screen readers). */
  hideLegend?: boolean;
  hint?: ReactNode;
  error?: string;
  id?: string;
  children: ReactNode;
  className?: string;
}

/** fieldset + legend wrapper for groups of checkboxes or radios. */
export function ChoiceGroup({ legend, hideLegend, hint, error, id, children, className }: ChoiceGroupProps) {
  const errorId = error && id ? `${id}-error` : undefined;
  return (
    <fieldset className={cn("min-w-0", className)} aria-describedby={errorId} aria-invalid={error ? true : undefined}>
      <legend className={cn("mb-1 text-sm font-semibold text-ink", hideLegend && "sr-only")}>{legend}</legend>
      {hint && <p className="mb-1 text-sm text-ink-muted">{hint}</p>}
      <div className="flex flex-col">{children}</div>
      {error && (
        <p id={errorId} className="mt-1 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
