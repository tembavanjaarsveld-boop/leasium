import { AppHeader } from "@/components/app-shell";
import { EmptyState, PageHeader, SectionPanel, StatusBadge } from "@/components/ui";
import type { LucideIcon } from "lucide-react";

type PlaceholderItem = {
  label: string;
  detail: string;
};

type ModulePlaceholderProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  status: string;
  items: PlaceholderItem[];
  emptyTitle: string;
  emptyDescription: string;
};

export function ModulePlaceholder({
  title,
  description,
  icon: Icon,
  status,
  items,
  emptyTitle,
  emptyDescription,
}: ModulePlaceholderProps) {
  return (
    <main className="min-h-screen">
      <AppHeader />

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5">
        <PageHeader title={title} description={description} />

        <section className="grid gap-3 md:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-border bg-white p-4 shadow-leasiumXs"
            >
              <div className="text-sm font-semibold">{item.label}</div>
              <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </section>

        <SectionPanel
          title="Module status"
          description="This workspace is queued for the next implementation pass."
          icon={<Icon size={17} className="text-primary" />}
          actions={<StatusBadge tone="primary">{status}</StatusBadge>}
        >
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </SectionPanel>
      </div>
    </main>
  );
}
