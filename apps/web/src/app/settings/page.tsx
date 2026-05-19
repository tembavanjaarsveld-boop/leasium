import { Settings } from "lucide-react";

import { ModulePlaceholder } from "@/components/module-placeholder";

export default function SettingsPage() {
  return (
    <ModulePlaceholder
      title="Settings"
      description="Manage workspace configuration, team access, and operational defaults."
      icon={Settings}
      status="Queued"
      items={[
        {
          label: "Workspace",
          detail: "Entity defaults, billing preferences, and portfolio setup.",
        },
        {
          label: "Access",
          detail: "Roles for owners, admins, finance, operations, and agents.",
        },
        {
          label: "Automation",
          detail: "Defaults for reminders, intake handling, and review workflows.",
        },
      ]}
      emptyTitle="Settings coming soon"
      emptyDescription="This route is ready while configuration screens are being shaped."
    />
  );
}
