import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";

export const metadata: Metadata = {
  title: { template: "%s · Admin · DriveEasy", default: "Admin · DriveEasy" },
  robots: { index: false, follow: false },
};

/** Frame only. Every admin page checks the admin role itself (and the services check again). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
