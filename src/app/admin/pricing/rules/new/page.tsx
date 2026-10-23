import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "../../../_lib/auth";
import { ruleOptions } from "../../_lib";
import { createRuleAction } from "../../actions";
import { RuleForm } from "../../forms";

export const metadata: Metadata = { title: "New pricing rule" };

export default async function NewRulePage() {
  const actor = await requireAdminPage("/admin/pricing/rules/new");
  const options = await ruleOptions(actor);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Pricing", href: "/admin/pricing" }, { label: "New rule" }]} title="Add a pricing rule" />
      <Card padded>
        <RuleForm action={createRuleAction} submitLabel="Create rule" {...options} />
      </Card>
    </>
  );
}
