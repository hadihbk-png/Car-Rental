import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { getBranch } from "@/lib/fleet/catalog";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "../../_lib/auth";
import { ActionForm } from "../../_components/action-form";
import { deleteBranchAction, updateBranchAction } from "../actions";
import { BranchForm } from "../branch-form";

export const metadata: Metadata = { title: "Edit branch" };

export default async function EditBranchPage({ params, searchParams }: PageProps<"/admin/branches/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await requireAdminPage(`/admin/branches/${id}`);
  let branch;
  try {
    branch = await getBranch(id);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Branches", href: "/admin/branches" }, { label: branch.name }]} title={branch.name} eyebrow={branch.code} />
      {sp.saved && (
        <Notice tone="success" className="mb-4" live>
          Branch created.
        </Notice>
      )}
      <div className="flex flex-col gap-6">
        <Card padded>
          <BranchForm action={updateBranchAction.bind(null, branch.id)} branch={branch} defaultTimeZone={branch.timezone} submitLabel="Save branch" />
        </Card>
        <Card>
          <CardHeader title="Delete branch" description="Only possible when no cars, reservations or prices use it. Otherwise mark it inactive." />
          <CardBody>
            <ActionForm
              action={deleteBranchAction.bind(null, branch.id)}
              submitLabel="Delete branch"
              submitVariant="danger"
              pendingLabel="Deleting…"
              confirmMessage={`Delete ${branch.name}? This cannot be undone.`}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
