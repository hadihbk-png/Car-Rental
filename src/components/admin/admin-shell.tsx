import { Suspense, type ReactNode } from "react";
import { AdminNav } from "./admin-nav";
import { AdminNavList } from "./admin-nav-list";

export interface AdminShellProps {
  children: ReactNode;
  /** Optional counts shown next to nav items, e.g. { reservations: 4, checkin: 2 }. */
  counts?: Partial<Record<string, number>>;
}

/** Admin area frame: sidebar on desktop, horizontally scrolling tabs on mobile. */
export function AdminShell({ children, counts }: AdminShellProps) {
  return (
    <div className="container-page flex flex-1 flex-col gap-6 py-6 lg:flex-row lg:gap-8 lg:py-10">
      <aside className="lg:w-60 lg:shrink-0">
        {/* usePathname() suspends while prerendering routes with unknown params (e.g. /admin/fleet/[id]);
            the fallback is the same nav without the active highlight, so the layout stays in the static shell. */}
        <Suspense fallback={<AdminNavList current="" counts={counts} />}>
          <AdminNav counts={counts} />
        </Suspense>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
