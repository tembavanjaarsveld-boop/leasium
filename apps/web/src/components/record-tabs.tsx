import { cn } from "@/lib/utils";

export type RecordTab<TId extends string = string> = {
  id: TId;
  label: string;
};

type RecordTabsProps<TTab extends RecordTab> = {
  tabs: readonly TTab[];
  ariaLabel: string;
  activeTab?: TTab["id"];
  onTabChange?: (tabId: TTab["id"]) => void;
  className?: string;
};

export function RecordTabs<TTab extends RecordTab>({
  tabs,
  ariaLabel,
  activeTab,
  onTabChange,
  className,
}: RecordTabsProps<TTab>) {
  return (
    <nav
      aria-label={ariaLabel}
      role={onTabChange ? "tablist" : undefined}
      data-ui="record-tabs"
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-white p-0.5 text-[13px] font-semibold shadow-leasiumXs",
        className,
      )}
    >
      {tabs.map((tab, index) => {
        const selected = activeTab ? activeTab === tab.id : index === 0;
        const tabClassName = cn(
          "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3.5 transition duration-200 ease-leasium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2",
          selected
            ? "bg-primary text-white shadow-leasiumXs"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        );
        const content = (
          <>
            {selected ? (
              <span
                aria-hidden="true"
                data-ui="record-tab-brand-dot"
                className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_2px_rgba(255,255,255,0.18)]"
              />
            ) : null}
            <span>{tab.label}</span>
          </>
        );

        if (onTabChange) {
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${tab.id}-panel`}
              data-state={selected ? "active" : "inactive"}
              className={tabClassName}
              onClick={() => onTabChange(tab.id)}
            >
              {content}
            </button>
          );
        }

        return (
          <a
            key={tab.id}
            href={`#${tab.id}`}
            data-state={selected ? "active" : "inactive"}
            className={tabClassName}
          >
            {content}
          </a>
        );
      })}
    </nav>
  );
}
