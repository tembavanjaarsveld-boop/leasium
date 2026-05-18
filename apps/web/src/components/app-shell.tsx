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
    <header className="border-b border-border bg-white/95">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3">
            <LeasiumMark />
            <div>
              <h1 className="text-lg font-semibold tracking-normal">Leasium</h1>
              <p className="text-sm text-muted-foreground">Lease operations</p>
            </div>
          </Link>
          <nav className="flex items-center gap-1 rounded-md border border-border bg-muted p-1">
            {navItems.map((item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-white hover:text-foreground",
                    active && "bg-white text-foreground shadow-sm",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {children ? <div className="w-full max-w-xs">{children}</div> : null}
      </div>
    </header>
  );
}
