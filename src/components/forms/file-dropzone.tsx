"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { cn } from "@/lib/ui/cn";
import { describeAccept, formatBytes, validateFile } from "@/lib/ui/files";
import { AlertCircleIcon, FileIcon, UploadIcon } from "@/components/ui/icons";

export interface FileDropzoneProps {
  /** Form field name; the file is submitted with the surrounding <form>. */
  name: string;
  label: string;
  /** MIME types, e.g. ["image/jpeg", "image/png", "application/pdf"]. */
  accept: readonly string[];
  maxBytes: number;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  /** Server-side error for this field. */
  error?: string;
  /** Name of a file already on record (e.g. "Licence uploaded 12 Oct 2026"). */
  existingFileLabel?: string;
  /** Called with the accepted file (or null when cleared/invalid). */
  onFileChange?: (file: File | null) => void;
  className?: string;
}

/**
 * Upload field with drag-and-drop, image preview and instant type/size checks.
 * It wraps a real <input type="file">, so it works with server actions and without drag support.
 */
export function FileDropzone({
  name,
  label,
  accept,
  maxBytes,
  required,
  disabled,
  hint,
  error,
  existingFileLabel,
  onFileChange,
  className,
}: FileDropzoneProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const accepted = (f: File | null) => {
    if (!f) {
      setFile(null);
      setPreview(null);
      setLocalError(null);
      onFileChange?.(null);
      return;
    }
    const problem = validateFile(f, { accept, maxBytes });
    if (problem) {
      setLocalError(problem);
      setFile(null);
      setPreview(null);
      if (inputRef.current) inputRef.current.value = "";
      onFileChange?.(null);
      return;
    }
    setLocalError(null);
    setFile(f);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    onFileChange?.(f);
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped || !inputRef.current) return;
    // Put the dropped file into the real input so the form submits it.
    const dt = new DataTransfer();
    dt.items.add(dropped);
    inputRef.current.files = dt.files;
    accepted(dropped);
  };

  const shownError = localError ?? error;
  const hintText = hint ?? `${describeAccept(accept)}, up to ${formatBytes(maxBytes)}.`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span id={`${id}-label`} className="text-sm font-semibold text-ink">
        {label}
        {required && (
          <span className="ml-0.5 text-red-700" aria-hidden="true">
            *
          </span>
        )}
      </span>
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "relative flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          "has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus",
          dragging ? "border-brand-600 bg-brand-50" : shownError ? "border-red-400 bg-red-50/50" : "border-line-strong bg-surface hover:border-brand-500 hover:bg-brand-50/40",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          name={name}
          accept={accept.join(",")}
          required={required && !existingFileLabel}
          disabled={disabled}
          aria-labelledby={`${id}-label`}
          aria-describedby={[hintId, shownError ? errorId : null].filter(Boolean).join(" ")}
          aria-invalid={shownError ? true : undefined}
          className="sr-only"
          onChange={(e) => accepted(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="flex w-full items-center gap-4 text-left">
            {preview ? (
              <Image src={preview} alt="Preview of the selected file" width={96} height={64} unoptimized className="h-16 w-24 shrink-0 rounded-lg object-cover ring-1 ring-line" />
            ) : (
              <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-ink-muted">
                <FileIcon size={28} />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{file.name}</span>
              <span className="block text-sm text-ink-muted">{formatBytes(file.size)} · Click or drop to replace</span>
            </span>
          </div>
        ) : (
          <>
            <span className="flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-700" aria-hidden="true">
              <UploadIcon />
            </span>
            <span className="text-sm text-ink">
              <span className="font-semibold text-brand-700 underline underline-offset-2">Choose a file</span> or drag it here
            </span>
            {existingFileLabel && <span className="text-sm text-ink-muted">Current: {existingFileLabel}</span>}
          </>
        )}
      </label>
      <p id={hintId} className="text-sm text-ink-muted">
        {hintText}
      </p>
      <p id={errorId} aria-live="polite" className={cn("flex items-start gap-1.5 text-sm font-medium text-red-700", !shownError && "sr-only")}>
        {shownError && <AlertCircleIcon size={16} className="mt-0.5 shrink-0" />}
        {shownError ?? ""}
      </p>
      {file && (
        <button
          type="button"
          className="self-start rounded text-sm font-semibold text-ink-muted underline underline-offset-2 hover:text-ink"
          onClick={() => {
            if (inputRef.current) inputRef.current.value = "";
            accepted(null);
          }}
        >
          Remove file
        </button>
      )}
    </div>
  );
}
