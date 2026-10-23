/** Client-side file checks for uploads. The server re-validates; this is only for fast feedback. */

export interface FileLike {
  name: string;
  size: number;
  type: string;
}

export interface FileRules {
  /** MIME types, e.g. ["image/jpeg", "image/png", "application/pdf"]. Wildcards like "image/*" allowed. */
  accept: readonly string[];
  maxBytes: number;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

const LABELS: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/heic": "HEIC",
  "application/pdf": "PDF",
  "image/*": "images",
};

/** "JPG, PNG or PDF" */
export function describeAccept(accept: readonly string[]): string {
  const labels = accept.map((a) => LABELS[a] ?? a.split("/").pop()?.toUpperCase() ?? a);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

function matchesAccept(type: string, accept: readonly string[]): boolean {
  return accept.some((a) => (a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a));
}

/** Returns a user-facing error message, or null when the file is acceptable. */
export function validateFile(file: FileLike, rules: FileRules): string | null {
  if (file.size === 0) return "This file is empty. Please choose another file.";
  if (!matchesAccept(file.type, rules.accept)) {
    return `${file.name} is not a supported file type. Use ${describeAccept(rules.accept)}.`;
  }
  if (file.size > rules.maxBytes) {
    return `${file.name} is ${formatBytes(file.size)}. The maximum size is ${formatBytes(rules.maxBytes)}.`;
  }
  return null;
}
