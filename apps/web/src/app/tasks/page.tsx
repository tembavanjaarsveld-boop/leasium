import { ClipboardList } from "lucide-react";

import { ModulePlaceholder } from "@/components/module-placeholder";

export default function TasksPage() {
  return (
    <ModulePlaceholder
      title="Tasks"
      description="Track lease follow-ups, approvals, and owner actions from one work queue."
      icon={ClipboardList}
      status="Queued"
      items={[
        {
          label: "Due work",
          detail: "Rent reviews, renewals, options, and onboarding follow-ups.",
        },
        {
          label: "Owners",
          detail: "Assign responsibility across property, finance, and operations.",
        },
        {
          label: "Priority",
          detail: "Keep critical dates visible before they become overdue.",
        },
      ]}
      emptyTitle="Task queue coming soon"
      emptyDescription="Navigation is ready while the working task list is being connected."
    />
  );
}
