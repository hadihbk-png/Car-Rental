import type { ReactNode } from "react";

/** Centered full-height message used by not-found, error and access pages. */
export function StatusPage({
  code,
  title,
  children,
  actions,
}: {
  code?: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="container-page flex flex-1 flex-col items-center justify-center py-16 text-center sm:py-24">
      {code && <p className="text-sm font-bold tracking-widest text-brand-700 uppercase">{code}</p>}
      <h1 className="mt-2 text-3xl font-extrabold text-ink sm:text-4xl">{title}</h1>
      {children && <div className="mt-4 max-w-lg text-base leading-relaxed text-ink-muted">{children}</div>}
      {actions && <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}
