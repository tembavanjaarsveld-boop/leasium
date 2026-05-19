import { BarChart3 } from "lucide-react";

import { ModulePlaceholder } from "@/components/module-placeholder";

export default function ReportsPage() {
  return (
    <ModulePlaceholder
      title="Reports"
      description="Summarise portfolio health, lease movement, and operational exceptions."
      icon={BarChart3}
      status="Queued"
      items={[
        {
          label: "Portfolio health",
          detail: "Track occupancy, expiries, income, and key portfolio changes.",
        },
        {
          label: "Exceptions",
          detail: "Surface overdue obligations, missing details, and billing blockers.",
        },
        {
          label: "Exports",
          detail: "Prepare board-ready and finance-ready reporting packs.",
        },
      ]}
      emptyTitle="Reports coming soon"
      emptyDescription="The reporting workspace is reserved while metrics are connected."
    />
  );
}
