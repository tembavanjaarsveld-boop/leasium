"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import { Bell, Command, Keyboard, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { LeasiumMark } from "@/components/brand";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  matchPaths?: string[];
};

type CommandAction = {
  href: string;
  label: string;
  meta: string;
};

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/intake", label: "Smart Intake" },
  {
    href: "/properties",
    label: "Portfolio",
    matchPaths: ["/properties", "/tenants", "/portfolio-qa"],
  },
  { href: "/operations", label: "Work" },
  { href: "/billing-readiness", label: "Billing" },
  { href: "/insights", label: "Insights" },
  { href: "/settings", label: "Settings" },
];

const frequentActions: CommandAction[] = [
  {
    href: "/intake",
    label: "Upload document",
    meta: "Smart Intake",
  },
  {
    href: "/properties",
    label: "Add property",
    meta: "Portfolio",
  },
  {
    href: "/tenants",
    label: "Add tenant",
    meta: "Portfolio",
  },
  {
    href: "/billing-readiness",
    label: "Review billing blockers",
    meta: "Billing",
  },
  {
    href: "/operations",
    label: "View operations queue",
    meta: "Work",
  },
  {
    href: "/operations",
    label: "Open maintenance work orders",
    meta: "Work",
  },
  {
    href: "/operations",
    label: "Open arrears cases",
    meta: "Work",
  },
  {
    href: "/notifications",
    label: "Open notifications",
    meta: "Work",
  },
  {
    href: "/portfolio-qa",
    label: "Data cleanup / Portfolio QA",
    meta: "Portfolio",
  },
  {
    href: "/insights",
    label: "Open portfolio insights",
    meta: "Insights",
  },
];

const moduleJumpActions: CommandAction[] = [
  ...navItems.map((item) => ({
    href: item.href,
    label: `Open ${item.label}`,
    meta: "Module",
  })),
  {
    href: "/tenants",
    label: "Open tenant directory",
    meta: "Portfolio",
  },
];

const commandActions: CommandAction[] = [
  ...frequentActions,
  ...moduleJumpActions,
];

type ShortcutNav = {
  key: string;
  href: string;
  label: string;
};

// Linear-style "Go to" navigation. Press G, then the key, to jump.
// Kept intentionally small — these are the routes operators visit
// most often during a typical session.
const SHORTCUT_NAV: ShortcutNav[] = [
  { key: "d", href: "/", label: "Dashboard" },
  { key: "i", href: "/intake", label: "Smart Intake" },
  { key: "p", href: "/properties", label: "Properties" },
  { key: "t", href: "/tenants", label: "Tenants" },
  { key: "o", href: "/operations", label: "Work (Operations)" },
  { key: "b", href: "/billing-readiness", label: "Billing Readiness" },
  { key: "n", href: "/notifications", label: "Notifications" },
  { key: "q", href: "/portfolio-qa", label: "Portfolio QA" },
  { key: "s", href: "/settings", label: "Settings" },
];

const GLOBAL_SHORTCUTS = [
  { combo: "Cmd / Ctrl + K", label: "Open command search" },
  { combo: "G then letter", label: "Jump to a module (see Go to list)" },
  { combo: "?", label: "Show this keyboard cheatsheet" },
  { combo: "Esc", label: "Close any open dialog" },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return false;
}

function OperatorUserControl() {
  const { isLoaded, isSignedIn } = useUser();

  if (isLoaded && isSignedIn) {
    return <UserButton />;
  }

  return (
    <Link
      href="/sign-in"
      className="inline-flex min-h-11 items-center rounded-xl border border-border-strong bg-white px-3 text-sm font-semibold text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
    >
      Sign in
    </Link>
  );
}

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const clerkConfigured = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  const [commandOpen, setCommandOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [shortcutPending, setShortcutPending] = useState(false);
  const [query, setQuery] = useState("");
  const shortcutTimeoutRef = useRef<number | null>(null);
  const filteredActions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return commandActions.slice(0, 8);
    }
    return commandActions
      .filter(
        (action) =>
          action.label.toLowerCase().includes(needle) ||
          action.meta.toLowerCase().includes(needle) ||
          action.href.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [query]);

  useEffect(() => {
    function clearShortcutWindow() {
      if (shortcutTimeoutRef.current !== null) {
        window.clearTimeout(shortcutTimeoutRef.current);
        shortcutTimeoutRef.current = null;
      }
      setShortcutPending(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      // Cmd+K / Ctrl+K — command search (toggle).
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        clearShortcutWindow();
        setCommandOpen((open) => !open);
        return;
      }

      // Escape — close anything open.
      if (event.key === "Escape") {
        clearShortcutWindow();
        setCommandOpen(false);
        setCheatsheetOpen(false);
        return;
      }

      // Ignore single-letter shortcuts while typing or with modifier keys.
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }

      // ? — open the keyboard cheatsheet.
      if (event.key === "?") {
        event.preventDefault();
        clearShortcutWindow();
        setCheatsheetOpen((open) => !open);
        return;
      }

      // G — start a "Go to" shortcut window. The next single letter
      // within 1.5s navigates to that module.
      if (event.key.toLowerCase() === "g" && !shortcutPending) {
        event.preventDefault();
        setShortcutPending(true);
        shortcutTimeoutRef.current = window.setTimeout(() => {
          setShortcutPending(false);
          shortcutTimeoutRef.current = null;
        }, 1500);
        return;
      }

      // While a G shortcut is pending, the next key triggers nav.
      if (shortcutPending) {
        const target = SHORTCUT_NAV.find(
          (entry) => entry.key === event.key.toLowerCase(),
        );
        clearShortcutWindow();
        if (target) {
          event.preventDefault();
          router.push(target.href);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearShortcutWindow();
    };
  }, [router, shortcutPending]);

  return (
    <header className="border-b border-border bg-white/95 backdrop-blur">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-3 px-5 py-3 md:grid-cols-[minmax(280px,1fr)_minmax(220px,auto)] min-[1600px]:max-w-none min-[1600px]:grid-cols-[minmax(270px,max-content)_minmax(0,1fr)_auto]">
        <div className="min-w-0 justify-self-start min-[1600px]:min-w-[270px]">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <LeasiumMark className="h-11 w-11" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-5 tracking-normal">
                Leasium
              </h1>
              <p className="truncate whitespace-nowrap text-sm leading-5 text-muted-foreground">
                Lease operations, automated
              </p>
            </div>
          </Link>
        </div>
        <nav
          aria-label="Primary"
          className="order-3 flex max-w-full min-w-0 flex-wrap items-center gap-1 rounded-2xl border border-border bg-white p-1 shadow-leasiumXs md:col-span-2 min-[1600px]:order-none min-[1600px]:col-span-1"
        >
          {navItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : (item.matchPaths ?? [item.href]).some((path) =>
                    pathname.startsWith(path),
                  );
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
            title="Search (Cmd K)"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border-strong bg-white text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          >
            <Search size={15} />
          </button>
          <button
            type="button"
            onClick={() => setCheatsheetOpen(true)}
            aria-label="Show keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border-strong bg-white text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted"
          >
            <Keyboard size={15} />
          </button>
          <Link
            href="/notifications"
            aria-label="Open notifications"
            title="Notifications"
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border-strong bg-white text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted",
              pathname.startsWith("/notifications") &&
                "border-primary/30 bg-leasium-blue-soft text-primary",
            )}
          >
            <Bell size={15} />
          </Link>
          {children ? (
            <div className="min-w-40 flex-1 sm:max-w-xs">{children}</div>
          ) : null}
          {clerkConfigured ? (
            <div className="flex h-11 shrink-0 items-center">
              <OperatorUserControl />
            </div>
          ) : null}
        </div>
      </div>
      {shortcutPending ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-white px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-leasiumSm">
          G… press a letter to jump (D/P/T/O/I/B/N/Q/S)
        </div>
      ) : null}
      {cheatsheetOpen ? (
        <div className="fixed inset-0 z-50 bg-leasium-navy-900/30 px-4 py-20 backdrop-blur-sm">
          <div className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-border bg-white shadow-leasiumLg">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Keyboard size={17} className="text-primary" />
              <h2 className="flex-1 text-sm font-semibold text-foreground">
                Keyboard shortcuts
              </h2>
              <button
                type="button"
                onClick={() => setCheatsheetOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Close shortcuts"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid gap-4 p-4">
              <div className="grid gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Global
                </div>
                <div className="grid gap-1.5">
                  {GLOBAL_SHORTCUTS.map((shortcut) => (
                    <div
                      key={shortcut.combo}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
                    >
                      <span className="text-foreground">{shortcut.label}</span>
                      <kbd className="rounded-md border border-border bg-white px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {shortcut.combo}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Go to (press G, then…)
                </div>
                <div className="grid gap-1.5">
                  {SHORTCUT_NAV.map((entry) => (
                    <div
                      key={entry.key}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
                    >
                      <span className="text-foreground">{entry.label}</span>
                      <kbd className="rounded-md border border-border bg-white px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        G {entry.key.toUpperCase()}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Shortcuts ignore input fields, so typing in any text box is
                safe.
              </p>
            </div>
          </div>
        </div>
      ) : null}
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
                  onClick={(event) => {
                    event.preventDefault();
                    setCommandOpen(false);
                    router.push(action.href);
                  }}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-sm transition hover:bg-muted"
                >
                  <span className="font-semibold text-foreground">
                    {action.label}
                  </span>
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
