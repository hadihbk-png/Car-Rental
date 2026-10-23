import type { Metadata } from "next";
import Link from "next/link";
import type { Actor } from "@/lib/auth";
import { listBranches, listExtras } from "@/lib/fleet/catalog";
import { listOneWayFees, listPricingRules } from "@/lib/pricing/admin";
import { formatMoney } from "@/lib/ui/money";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TagIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/table";
import { requireAdminPage } from "../_lib/auth";
import { ActionForm, FMoney, FSelect } from "../_components/action-form";
import { deleteFeeAction, saveFeeAction } from "./actions";

export const metadata: Metadata = { title: "Pricing" };

const TABS = ["rules", "fees", "extras"] as const;
const SAVED: Record<string, string> = { rule: "Pricing rule created.", deleted: "Pricing rule deleted.", extra: "Extra created." };

export default async function AdminPricingPage({ searchParams }: PageProps<"/admin/pricing">) {
  const sp = await searchParams;
  const actor = await requireAdminPage("/admin/pricing");
  const tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as (typeof TABS)[number]) : "rules";

  return (
    <>
      <PageHeader title="Pricing" description="Daily rates, one-way fees and extras. VAT is added at checkout." />
      {typeof sp.saved === "string" && SAVED[sp.saved] && (
        <Notice tone="success" className="mb-4" live>
          {SAVED[sp.saved]}
        </Notice>
      )}
      <LinkTabs
        label="Pricing sections"
        className="mb-6"
        items={[
          { href: "/admin/pricing", label: "Daily rates", current: tab === "rules" },
          { href: "/admin/pricing?tab=fees", label: "One-way fees", current: tab === "fees" },
          { href: "/admin/pricing?tab=extras", label: "Extras", current: tab === "extras" },
        ]}
      />
      {tab === "rules" && <Rules actor={actor} />}
      {tab === "fees" && <Fees actor={actor} />}
      {tab === "extras" && <Extras />}
    </>
  );
}

async function Rules({ actor }: { actor: Actor }) {
  const rules = await listPricingRules(actor);
  return (
    <section aria-label="Daily rates" className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Link href="/admin/pricing/rules/new" className={buttonClasses("primary")}>
          Add pricing rule
        </Link>
      </div>
      <p className="text-sm text-ink-muted">
        The most specific matching rule wins: vehicle over category, then branch-specific, then dated season, then priority, then longer minimum days.
      </p>
      <DataTable
        caption="Pricing rules"
        rows={rules}
        getRowKey={(r) => r.id}
        empty={<EmptyState icon={<TagIcon />} title="No pricing rules" description="Cars without a matching rule can't be booked." />}
        columns={[
          {
            key: "name",
            header: "Rule",
            cell: (r) => (
              <Link href={`/admin/pricing/rules/${r.id}`} className="font-semibold text-brand-800 hover:underline">
                {r.name}
              </Link>
            ),
          },
          { key: "applies", header: "Applies to", cell: (r) => (r.vehiclePlate ? `Vehicle ${r.vehiclePlate}` : (r.categoryName ?? "—")) },
          { key: "branch", header: "Branch", cell: (r) => r.branchCode ?? "All" },
          { key: "days", header: "Days", cell: (r) => `${r.minDays}${r.maxDays ? `–${r.maxDays}` : "+"}` },
          { key: "dates", header: "Season", cell: (r) => (r.validFrom || r.validTo ? `${r.validFrom ?? "…"} → ${r.validTo ?? "…"}` : "All year") },
          { key: "rate", header: "Daily rate", align: "right", cell: (r) => <span className="tabular">{formatMoney(r.dailyRateFils, "AED")}</span> },
          { key: "active", header: "Status", cell: (r) => (r.isActive ? <Badge tone="success" dot>Active</Badge> : <Badge dot>Off</Badge>) },
        ]}
      />
    </section>
  );
}

async function Fees({ actor }: { actor: Actor }) {
  const [fees, branches] = await Promise.all([listOneWayFees(actor), listBranches({ includeInactive: true })]);
  const options = branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }));
  return (
    <div className="flex flex-col gap-6">
      <DataTable
        caption="One-way fees"
        rows={fees}
        getRowKey={(f) => f.id}
        empty={<EmptyState icon={<TagIcon />} title="No one-way routes" description="Customers can only return to the pick-up branch." />}
        columns={[
          { key: "from", header: "From", cell: (f) => f.fromName },
          { key: "to", header: "To", cell: (f) => f.toName },
          { key: "fee", header: "Fee", align: "right", cell: (f) => <span className="tabular">{formatMoney(f.feeFils, "AED")}</span> },
          {
            key: "actions",
            header: "Actions",
            srOnlyHeader: true,
            align: "right",
            cell: (f) => (
              <ActionForm
                action={deleteFeeAction.bind(null, f.id)}
                submitLabel="Remove"
                submitVariant="ghost"
                pendingLabel="Removing…"
                confirmMessage={`Remove the ${f.fromCode} → ${f.toCode} route?`}
                className="items-end"
              />
            ),
          },
        ]}
      />
      <Card>
        <CardHeader title="Add or change a route" description="Saving an existing route updates its fee." />
        <CardBody>
          <ActionForm action={saveFeeAction} submitLabel="Save fee" idPrefix="fee-" fieldsClassName="sm:grid-cols-3">
            <FSelect name="fromBranchId" label="From" required placeholder="Choose" options={options} />
            <FSelect name="toBranchId" label="To" required placeholder="Choose" options={options} />
            <FMoney name="feeFils" label="Fee" required hint="Before VAT." />
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

async function Extras() {
  const extras = await listExtras({ includeInactive: true });
  return (
    <section aria-label="Extras" className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Link href="/admin/pricing/extras/new" className={buttonClasses("primary")}>
          Add extra
        </Link>
      </div>
      <DataTable
        caption="Extras"
        rows={extras}
        getRowKey={(x) => x.id}
        empty={<EmptyState icon={<TagIcon />} title="No extras" />}
        columns={[
          {
            key: "name",
            header: "Extra",
            cell: (x) => (
              <Link href={`/admin/pricing/extras/${x.id}`} className="font-semibold text-brand-800 hover:underline">
                {x.name}
              </Link>
            ),
          },
          { key: "code", header: "Code", cell: (x) => <span className="font-mono text-xs">{x.code}</span> },
          { key: "type", header: "Pricing", cell: (x) => (x.pricingType === "PER_DAY" ? "Per day" : "Per rental") },
          { key: "price", header: "Price", align: "right", cell: (x) => <span className="tabular">{formatMoney(x.priceFils, "AED")}</span> },
          { key: "cap", header: "Cap", align: "right", cell: (x) => (x.maxPriceFils !== null ? formatMoney(x.maxPriceFils, "AED") : "—") },
          { key: "qty", header: "Max qty", align: "right", cell: (x) => x.maxQuantity },
          { key: "active", header: "Status", cell: (x) => (x.isActive ? <Badge tone="success" dot>Offered</Badge> : <Badge dot>Hidden</Badge>) },
        ]}
      />
    </section>
  );
}
