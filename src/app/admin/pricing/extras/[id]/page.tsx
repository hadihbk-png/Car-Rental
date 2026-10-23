import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listExtras } from "@/lib/fleet/catalog";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "../../../_lib/auth";
import { updateExtraAction } from "../../actions";
import { ExtraForm } from "../../forms";

export const metadata: Metadata = { title: "Edit extra" };

export default async function EditExtraPage({ params }: PageProps<"/admin/pricing/extras/[id]">) {
  const { id } = await params;
  await requireAdminPage(`/admin/pricing/extras/${id}`);
  const extra = (await listExtras({ includeInactive: true })).find((x) => x.id === id);
  if (!extra) notFound();
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Pricing", href: "/admin/pricing?tab=extras" }, { label: extra.name }]} title={extra.name} />
      <Card padded>
        <ExtraForm action={updateExtraAction.bind(null, extra.id)} extra={extra} submitLabel="Save extra" />
      </Card>
    </>
  );
}
