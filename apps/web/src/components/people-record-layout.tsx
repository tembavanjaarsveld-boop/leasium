import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageTitle } from "@/components/ui";
import { cn } from "@/lib/utils";

export const peopleRecordTabs = [
  { id: "overview", label: "Overview" },
  { id: "financials", label: "Financials" },
  { id: "tasks", label: "Tasks" },
  { id: "notes", label: "Notes" },
  { id: "files", label: "Files" },
  { id: "activity", label: "Activity" },
] as const;

export function PeopleRecordLayout({
  backHref,
  backLabel,
  title,
  description,
  actions,
  summary,
  children,
  className,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-5", className)}>
      <section className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={backHref}
              className="mb-2 inline-flex min-h-8 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
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

        <nav
          aria-label="People record sections"
          className="flex gap-2 overflow-x-auto border-y border-border py-2"
        >
          {peopleRecordTabs.map((tab, index) => (
            <a
              key={tab.id}
              href={`#${tab.id}`}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2",
                index === 0
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {tab.label}
            </a>
          ))}
        </nav>

        {summary}
      </section>

      {children}
    </div>
  );
}
