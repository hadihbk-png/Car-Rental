"use client";

import { usePathname } from "next/navigation";
import { AdminNavList, activeId } from "./admin-nav-list";

export { ADMIN_NAV } from "./admin-nav-list";

/** Admin navigation with the active item from the URL. Render inside <Suspense> (see AdminShell). */
export function AdminNav({ counts }: { counts?: Partial<Record<string, number>> }) {
  return <AdminNavList current={activeId(usePathname())} counts={counts} />;
}
