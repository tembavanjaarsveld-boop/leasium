"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LeasiumMark } from "@/components/brand";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/properties", label: "Properties" },
  { href: "/tenants", label: "Tenants" },
];

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <header className="border-b border-border bg-white/95 backdrop-blur">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-3 px-5 py-3 md:grid-cols-[minmax(220px,1fr)_auto_minmax(220px,1fr)]">
        <div className="justify-self-center md:justify-self-start">
          <Link href="/" className="flex items-center gap-3">
            <LeasiumMark />
            <div>
              <h1 className="text-lg font-semibold tracking-normal">Leasium</h1>
              <p className="text-sm text-muted-foreground">Lease operations</p>
            </div>
          </Link>
        </div>
        <nav
          aria-label="Primary"
          className="inline-flex h-10 items-center gap-1 justify-self-center rounded-md border border-border bg-white p-1 shadow-sm"
        >
          {navItems.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex h-8 min-w-24 items-center justify-center rounded px-3 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground",
                  active &&
                    "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {children ? (
          <div className="w-full max-w-xs justify-self-center md:justify-self-end">
            {children}
          </div>
        ) : null}
      </div>
    </header>
  );
}
