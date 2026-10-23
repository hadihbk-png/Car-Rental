import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listPricingRules } from "@/lib/pricing/admin";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "../../../_lib/auth";
import { ActionForm } from "../../../_components/action-form";
import { ruleOptions } from "../../_lib";
import { deleteRuleAction, updateRuleAction } from "../../actions";
import { RuleForm } from "../../forms";

export const metadata: Metadata = { title: "Edit pricing rule" };

export default async function EditRulePage({ params }: PageProps<"/admin/pricing/rules/[id]">) {
  const { id } = await params;
  const actor = await requireAdminPage(`/admin/pricing/rules/${id}`);
  const [rules, options] = await Promise.all([listPricingRules(actor), ruleOptions(actor)]);
  const rule = rules.find((r) => r.id === id);
  if (!rule) notFound();
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Pricing", href: "/admin/pricing" }, { label: rule.name }]} title={rule.name} />
      <div className="flex flex-col gap-6">
        <Card padded>
          <RuleForm action={updateRuleAction.bind(null, rule.id)} rule={rule} submitLabel="Save rule" {...options} />
        </Card>
        <Card>
          <CardHeader title="Delete rule" description="Cars that only match this rule can no longer be booked. Consider switching it off instead." />
          <CardBody>
            <ActionForm action={deleteRuleAction.bind(null, rule.id)} submitLabel="Delete rule" submitVariant="danger" pendingLabel="Deleting…" confirmMessage={`Delete "${rule.name}"?`} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
