"use client";

import { Command, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { LeasiumMark } from "@/components/brand";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/intake", label: "Lease Inbox" },
  { href: "/properties", label: "Properties" },
  { href: "/tenants", label: "Tenants" },
  { href: "/tasks", label: "Tasks" },
  { href: "/billing-readiness", label: "Billing Readiness" },
  { href: "/insights", label: "Insights" },
  { href: "/settings", label: "Settings" },
];

const commandActions = [
  {
    href: "/intake",
    label: "Upload document",
    meta: "Lease Inbox",
  },
  {
    href: "/properties",
    label: "Add property",
    meta: "Properties",
  },
  {
    href: "/tenants",
    label: "Add tenant",
    meta: "Tenants",
  },
  {
    href: "/billing-readiness",
    label: "Review billing blockers",
    meta: "Billing Readiness",
  },
  {
    href: "/tasks",
    label: "View attention items",
    meta: "Tasks",
  },
  {
    href: "/insights",
    label: "Open portfolio insights",
    meta: "Insights",
  },
  ...navItems.map((item) => ({
    href: item.href,
    label: `Go to ${item.label}`,
    meta: "Navigation",
  })),
];

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredActions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return commandActions.slice(0, 8);
    }
    return commandActions
      .filter(
        (action) =>
          action.label.toLowerCase().includes(needle) ||
          action.meta.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="border-b border-border bg-white/95 backdrop-blur">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-3 px-5 py-3 md:grid-cols-[minmax(220px,1fr)_minmax(220px,auto)] xl:grid-cols-[minmax(240px,1fr)_auto_minmax(240px,1fr)]">
        <div className="min-w-0 justify-self-start">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <LeasiumMark className="h-11 w-11" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-5 tracking-normal">Leasium</h1>
              <p className="truncate whitespace-nowrap text-sm leading-5 text-muted-foreground">
                Lease operations, automated
              </p>
            </div>
          </Link>
        </div>
        <nav
          aria-label="Primary"
          className="no-scrollbar order-3 flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-border bg-white p-1 shadow-leasiumXs md:col-span-2 xl:order-none xl:col-span-1"
        >
          {navItems.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex min-h-9 shrink-0 items-center justify-center rounded-xl px-2.5 text-[13px] font-semibold text-muted-foreground transition duration-200 ease-leasium hover:bg-muted hover:text-foreground",
                  active &&
                    "bg-primary text-primary-foreground shadow-leasiumXs hover:bg-primary hover:text-primary-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex w-full min-w-0 items-center justify-start gap-2 md:justify-end md:justify-self-end">
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            aria-label="Open search"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          >
            <Search size={15} />
            <span className="hidden 2xl:inline">Search</span>
            <kbd className="hidden rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground 2xl:inline">
              Cmd K
            </kbd>
          </button>
          {children ? <div className="min-w-40 flex-1 sm:max-w-xs">{children}</div> : null}
        </div>
      </div>
      {commandOpen ? (
        <div className="fixed inset-0 z-50 bg-leasium-navy-900/30 px-4 py-20 backdrop-blur-sm">
          <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-border bg-white shadow-leasiumLg">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Command size={17} className="text-primary" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tenants, leases, actions..."
                className="min-h-10 flex-1 bg-transparent text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setCommandOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Close search"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-2">
              {filteredActions.map((action) => (
                <Link
                  key={`${action.meta}-${action.label}`}
                  href={action.href}
                  onClick={() => setCommandOpen(false)}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-sm transition hover:bg-muted"
                >
                  <span className="font-semibold text-foreground">{action.label}</span>
                  <span className="text-xs font-medium text-muted-foreground">
                    {action.meta}
                  </span>
                </Link>
              ))}
              {filteredActions.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No matching action.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
