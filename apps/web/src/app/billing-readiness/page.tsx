import { ReceiptText } from "lucide-react";

import { ModulePlaceholder } from "@/components/module-placeholder";

export default function BillingReadinessPage() {
  return (
    <ModulePlaceholder
      title="Billing Readiness"
      description="Review lease charges, GST treatment, and invoice blockers before billing runs."
      icon={ReceiptText}
      status="Queued"
      items={[
        {
          label: "Charge rules",
          detail: "Base rent, outgoings, parking, storage, and other billable lines.",
        },
        {
          label: "Checks",
          detail: "Spot missing tax codes, dates, amounts, and tenant billing contacts.",
        },
        {
          label: "Handover",
          detail: "Prepare clean billing data for finance workflows.",
        },
      ]}
      emptyTitle="Billing checks coming soon"
      emptyDescription="This route is in place while readiness workflows are built out."
    />
  );
}
