import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "../../../_lib/auth";
import { createExtraAction } from "../../actions";
import { ExtraForm } from "../../forms";

export const metadata: Metadata = { title: "New extra" };

export default async function NewExtraPage() {
  await requireAdminPage("/admin/pricing/extras/new");
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Pricing", href: "/admin/pricing?tab=extras" }, { label: "New extra" }]} title="Add an extra" />
      <Card padded>
        <ExtraForm action={createExtraAction} submitLabel="Create extra" />
      </Card>
    </>
  );
}
