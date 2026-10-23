import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { defaultTimeZone } from "@/app/_lib/trip";
import { requireAdminPage } from "../../_lib/auth";
import { createBranchAction } from "../actions";
import { BranchForm } from "../branch-form";

export const metadata: Metadata = { title: "New branch" };

export default async function NewBranchPage() {
  await requireAdminPage("/admin/branches/new");
  const tz = await defaultTimeZone();
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Branches", href: "/admin/branches" }, { label: "New" }]} title="Add a branch" />
      <Card padded>
        <BranchForm action={createBranchAction} defaultTimeZone={tz} submitLabel="Create branch" />
      </Card>
    </>
  );
}
