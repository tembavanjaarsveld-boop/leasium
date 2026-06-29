import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageTitle } from "@/components/ui";
import {
  RecordTabs,
  type RecordTab,
} from "@/components/record-tabs";
import { cn } from "@/lib/utils";

export const peopleRecordTabs = [
  { id: "overview", label: "Overview" },
  { id: "financials", label: "Financials" },
  { id: "tasks", label: "Tasks" },
  { id: "notes", label: "Notes" },
  { id: "files", label: "Files" },
  { id: "activity", label: "Activity" },
] as const;

export type PeopleRecordTab = RecordTab;

export function PeopleRecordLayout({
  backHref,
  backLabel,
  title,
  description,
  actions,
  summary,
  children,
  className,
  tabs,
  activeTab,
  onTabChange,
  tabAriaLabel = "People record sections",
}: {
  backHref: string;
  backLabel: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
  tabs?: readonly PeopleRecordTab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  tabAriaLabel?: string;
}) {
  const tabsToRender = tabs ?? peopleRecordTabs;

  return (
    <div className={cn("grid gap-5", className)}>
      <section className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={backHref}
              className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
            >
              <ArrowLeft size={14} />
              {backLabel}
            </Link>
            <PageTitle className="text-2xl leading-8">{title}</PageTitle>
            {description ? (
              <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>

        <RecordTabs
          tabs={tabsToRender}
          activeTab={activeTab}
          onTabChange={onTabChange}
          ariaLabel={tabAriaLabel}
        />

        {summary}
      </section>

      {children}
    </div>
  );
}
