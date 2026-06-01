"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  Command,
  FileSpreadsheet,
  Home,
  Keyboard,
  Menu,
  Monitor,
  Moon,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  Users,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { LeasiumMark } from "@/components/brand";
import {
  APPEARANCE_CHANGED_EVENT,
  APPEARANCE_STORAGE_KEY,
  appearanceModeFromEvent,
  applyAppearancePreference,
  createAppearanceChangeEvent,
  labelAppearanceMode,
  nextAppearanceMode,
  readAppearancePreference,
  SYSTEM_DARK_QUERY,
  type AppearanceMode,
  type ResolvedAppearance,
} from "@/lib/appearance";
import { getCommsQueueCounts } from "@/lib/api";
import { useOperatingMode } from "@/lib/use-operating-mode";
import { useUnmountDelay } from "@/lib/use-unmount-delay";
import { cn } from "@/lib/utils";

const COMMS_BADGE_ENTITY_KEY = "leasium.entity_id";
const ENTITY_CHANGED_EVENT = "leasium:entity-id-change";

function useCommsBadge(): { urgent: number; total: number } | null {
  const [entityId, setEntityId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    function syncEntityId() {
      setEntityId(window.localStorage.getItem(COMMS_BADGE_ENTITY_KEY));
    }
    syncEntityId();
    // Storage events cover other tabs; the custom event covers pages that
    // update the entity in this tab and notify the shell immediately.
    function onStorage(event: StorageEvent) {
      if (event.key === COMMS_BADGE_ENTITY_KEY) {
        setEntityId(event.newValue);
      }
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(ENTITY_CHANGED_EVENT, syncEntityId);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ENTITY_CHANGED_EVENT, syncEntityId);
    };
  }, []);

  const countsQuery = useQuery({
    queryKey: ["comms-queue-counts", entityId],
    queryFn: () => getCommsQueueCounts(entityId ?? ""),
    enabled: Boolean(entityId),
    // The sidebar fires this on every page mount; cache for 5 minutes so the
    // badge stays fresh without re-running the queue scan on every navigation.
    // `/comms/queue/counts` runs the full set of queue scanners server-side
    // (it is far from the "lightweight" call its name implies), so we do NOT
    // refetch on window focus — re-scanning every time the operator tabs back
    // to Leasium just hogs a backend worker and slows the page they're loading.
    // This keeps the root QueryClient's no-focus-refetch policy intact for the
    // one query that opted out of it. (See backend perf note: the counts
    // endpoint should compute counts without building full candidate payloads.)
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  return countsQuery.data
    ? { urgent: countsQuery.data.urgent, total: countsQuery.data.total }
    : null;
}

type NavItem = {
  href: string;
  label: string;
  matchPaths?: string[];
  icon: LucideIcon;
  shortcut?: string;
};

type CommandAction = {
  href: string;
  label: string;
  meta: string;
};

// Primary nav trimmed 2026-05-23 (external design review): 13 → 8 items,
// then consolidated 2026-05-31 (DoorLoop benchmark refocus): 8 → 7
// primary hubs plus Settings.
// Reachable via Cmd-K command palette but not in sidebar:
//   AI Inbox (folds conceptually into Smart Intake)
//   Tenants, Contractors (folded under People)
//   Contractors, Comms (folded under Work where task-shaped)
//   Billing Readiness, Statements (folded under Money)
//   Portfolio QA (cleanup workspace — palette-only)
// G-shortcuts for the removed items still work via SHORTCUT_NAV below
// so keyboard users keep their muscle memory while the IA settles.
// Pending Remba review.
const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: Home, shortcut: "G D" },
  {
    href: "/intake",
    label: "Smart Intake",
    icon: FileSpreadsheet,
    shortcut: "G I",
  },
  {
    href: "/properties",
    label: "Properties",
    matchPaths: ["/properties"],
    icon: Building2,
    shortcut: "G P",
  },
  {
    href: "/people",
    label: "People",
    matchPaths: ["/people", "/tenants", "/owners", "/contractors"],
    icon: Users,
    shortcut: "G E",
  },
  {
    href: "/operations",
    label: "Work",
    matchPaths: ["/operations", "/comms", "/notifications", "/tasks"],
    icon: Wrench,
    shortcut: "G O",
  },
  {
    href: "/money",
    label: "Money",
    matchPaths: ["/money", "/billing-readiness", "/statements"],
    icon: Wallet,
    shortcut: "G B",
  },
  { href: "/insights", label: "Insights", icon: Sparkles },
  {
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
    shortcut: "G S",
  },
];

const mobileBottomNavHrefs = [
  "/",
  "/properties",
  "/people",
  "/operations",
  "/money",
];
const mobileBottomNavItems = navItems.filter((item) =>
  mobileBottomNavHrefs.includes(item.href),
);

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
    meta: "People",
  },
  {
    href: "/billing-readiness",
    label: "Review billing blockers",
    meta: "Money",
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
    href: "/inbox",
    label: "Open AI Inbox",
    meta: "Smart Intake",
  },
  {
    href: "/contractors",
    label: "Open contractor directory",
    meta: "Work",
  },
  {
    href: "/comms",
    label: "Open comms queue",
    meta: "Work",
  },
  {
    href: "/statements",
    label: "Open owner statements",
    meta: "Money",
  },
  {
    href: "/people",
    label: "Open People hub",
    meta: "People",
  },
  {
    href: "/people?tab=tenants",
    label: "Open tenant directory",
    meta: "People",
  },
  {
    href: "/money",
    label: "Open Money hub",
    meta: "Money",
  },
  {
    href: "/billing-readiness",
    label: "Open Billing Readiness",
    meta: "Money",
  },
  {
    href: "/portfolio-qa",
    label: "Open Portfolio QA",
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
  { key: "m", href: "/inbox", label: "AI Inbox" },
  { key: "p", href: "/properties", label: "Properties" },
  { key: "t", href: "/people?tab=tenants", label: "Tenants" },
  { key: "e", href: "/people", label: "People hub" },
  { key: "o", href: "/operations", label: "Work (Operations)" },
  { key: "r", href: "/people?tab=vendors", label: "Vendors" },
  { key: "c", href: "/comms", label: "Comms queue" },
  { key: "f", href: "/statements", label: "Owner statements" },
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

const headerUtilityButtonClass =
  "h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition duration-200 ease-leasium hover:bg-muted hover:text-foreground";
const headerUtilityInlineButtonClass = cn(
  "inline-flex",
  headerUtilityButtonClass,
);
const shellLinkProps = { prefetch: false };

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
      {...shellLinkProps}
      href="/sign-in"
      className="inline-flex h-11 items-center rounded-lg px-3 text-sm font-semibold text-slate transition duration-200 ease-leasium hover:bg-muted"
    >
      Sign in
    </Link>
  );
}

function AppearanceToggle() {
  const [mode, setMode] = useState<AppearanceMode>("system");
  const [resolved, setResolved] = useState<ResolvedAppearance>("light");
  const modeRef = useRef<AppearanceMode>("system");

  useEffect(() => {
    function syncPreference(event?: Event) {
      const nextMode = event
        ? appearanceModeFromEvent(event) ?? readAppearancePreference()
        : readAppearancePreference();
      const nextResolved = applyAppearancePreference(nextMode);
      modeRef.current = nextMode;
      setMode(nextMode);
      setResolved(nextResolved);
    }
    function onStorage(event: StorageEvent) {
      if (event.key && event.key !== APPEARANCE_STORAGE_KEY) return;
      syncPreference();
    }
    function onSystemPreferenceChange() {
      if (modeRef.current === "system") syncPreference();
    }

    syncPreference();
    const mediaQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia(SYSTEM_DARK_QUERY)
        : null;
    window.addEventListener("storage", onStorage);
    window.addEventListener(APPEARANCE_CHANGED_EVENT, syncPreference);
    mediaQuery?.addEventListener("change", onSystemPreferenceChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(APPEARANCE_CHANGED_EVENT, syncPreference);
      mediaQuery?.removeEventListener("change", onSystemPreferenceChange);
    };
  }, []);

  function chooseAppearance(nextMode: AppearanceMode) {
    const nextResolved = applyAppearancePreference(nextMode);
    modeRef.current = nextMode;
    setMode(nextMode);
    setResolved(nextResolved);
    window.dispatchEvent(createAppearanceChangeEvent(nextMode));
  }

  const nextMode = nextAppearanceMode(mode);
  const Icon = mode === "system" ? Monitor : resolved === "dark" ? Moon : Sun;
  const label = `Appearance: ${mode} (${resolved}). Switch to ${labelAppearanceMode(
    nextMode,
  ).toLowerCase()}`;

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => chooseAppearance(nextMode)}
      title={label}
      className={headerUtilityInlineButtonClass}
    >
      <Icon size={15} />
    </button>
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Delayed-unmount controls so each modal/drawer plays its exit
  // animation before unmounting. Durations match the enter side: modals
  // use Base=200ms (matches modal-fade-scale), the mobile drawer uses
  // Slow=300ms (matches the drawer slide).
  const commandRender = useUnmountDelay(commandOpen, 200);
  const cheatsheetRender = useUnmountDelay(cheatsheetOpen, 200);
  const mobileNavRender = useUnmountDelay(mobileNavOpen, 300);
  const commsBadge = useCommsBadge();
  const { operatingMode } = useOperatingMode();
  const shortcutTimeoutRef = useRef<number | null>(null);

  // Owner statements are issued/disbursed to *third-party* owners — agent-only
  // framing (docs/account-operating-mode-ia.md). For a self_managed_owner, hide
  // the agent-framed entry points (Cmd-K action + the f→/statements shortcut)
  // while leaving the /statements route itself reachable.
  const hideOwnerStatementEntry = operatingMode === "self_managed_owner";
  const gatedCommandActions = useMemo(
    () =>
      hideOwnerStatementEntry
        ? commandActions.filter(
            (action) => action.href !== "/statements",
          )
        : commandActions,
    [hideOwnerStatementEntry],
  );
  const gatedShortcutNav = useMemo(
    () =>
      hideOwnerStatementEntry
        ? SHORTCUT_NAV.filter((entry) => entry.href !== "/statements")
        : SHORTCUT_NAV,
    [hideOwnerStatementEntry],
  );
  const shortcutLegend = useMemo(
    () => gatedShortcutNav.map((entry) => entry.key.toUpperCase()).join("/"),
    [gatedShortcutNav],
  );

  const filteredActions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return gatedCommandActions.slice(0, 8);
    }
    return gatedCommandActions
      .filter(
        (action) =>
          action.label.toLowerCase().includes(needle) ||
          action.meta.toLowerCase().includes(needle) ||
          action.href.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [query, gatedCommandActions]);

  // Toggle a body class so globals.css can apply the sidebar gutter
  // only when AppHeader is on the page (auth/setup pages skip it).
  useEffect(() => {
    document.body.classList.add("app-shell-active");
    return () => {
      document.body.classList.remove("app-shell-active");
    };
  }, []);

  useEffect(() => {
    return () => {
      if (shortcutTimeoutRef.current !== null) {
        window.clearTimeout(shortcutTimeoutRef.current);
        shortcutTimeoutRef.current = null;
      }
    };
  }, []);

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
        if (commandOpen) {
          setCommandOpen(false);
        } else {
          setQuery("");
          setCommandOpen(true);
        }
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
        const target = gatedShortcutNav.find(
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
    };
  }, [commandOpen, router, shortcutPending, gatedShortcutNav]);

  function isNavActive(item: NavItem): boolean {
    if (item.href === "/") {
      return pathname === "/";
    }
    return (item.matchPaths ?? [item.href]).some((path) =>
      pathname.startsWith(path),
    );
  }

  // Sidebar content is shared between the fixed desktop sidebar (`md` and
  // `lg+`) and the mobile drawer (sub-`md`). At `md` the fixed sidebar
  // collapses to a 64px icon-only rail, so brand text + nav labels +
  // shortcuts label hide at `md` and reappear at `lg`; the Work comms
  // badge stays visible as a compact corner count.
  // The mobile drawer is sub-`md` only (the hamburger is hidden at `md+`),
  // so when the drawer opens it never hits the `md` media query and
  // labels stay visible inside it. Pending Remba review (2026-05-23
  // external review §8.1 — sidebar collapse at md instead of disappearing
  // at lg).
  const sidebarContent = (
    <>
      <Link
        {...shellLinkProps}
        href="/"
        onClick={() => setMobileNavOpen(false)}
        className="flex min-w-0 items-center gap-3 px-4 py-5 md:justify-center md:px-2 lg:justify-start lg:px-4"
        title="Leasium"
      >
        <LeasiumMark className="h-10 w-10" />
        <div className="min-w-0 md:hidden lg:block">
          <h1 className="truncate text-base font-semibold leading-5 tracking-normal text-white">
            Leasium
          </h1>
          <p className="truncate whitespace-nowrap text-xs leading-4 text-leasium-slate-300">
            Lease operations
          </p>
        </div>
      </Link>
      <nav
        aria-label="Primary"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2"
      >
        {navItems.map((item) => {
          const active = isNavActive(item);
          const Icon = item.icon;
          const showCommsBadge =
            item.href === "/operations" &&
            commsBadge !== null &&
            commsBadge.total > 0;
          const commsBadgeLabel =
            showCommsBadge && commsBadge
              ? `${commsBadge.total} drafts in the comms queue, ${commsBadge.urgent} urgent`
              : null;
          const navLabel = commsBadgeLabel
            ? `${item.label}, ${commsBadgeLabel}`
            : item.label;
          return (
            <Link
              {...shellLinkProps}
              key={item.href}
              href={item.href}
              onClick={() => setMobileNavOpen(false)}
              // Intent-based prefetch: warm the route bundle when the operator
              // hovers or focuses a nav item, so the click feels instant. This
              // is deliberately narrower than Next's default prefetch-on-render
              // (disabled via shellLinkProps) — we only fetch the one
              // destination the cursor is telegraphing, not every sidebar link
              // on every page. router.prefetch is idempotent/cached, so
              // repeated hovers are cheap.
              onMouseEnter={() => router.prefetch(item.href)}
              onFocus={() => router.prefetch(item.href)}
              // `title` provides a hover tooltip when the sidebar is
              // collapsed to icon-only at `md`. Labels still render at
              // sub-`md` (drawer) and `lg+` (full sidebar).
              title={navLabel}
              aria-label={navLabel}
              className={cn(
                // Hover state uses a subtle white tint so the row reads
                // as "row under cursor" against the navy-900 sidebar.
                "group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-leasium-slate-300 transition hover:bg-white/[0.06] hover:text-white md:justify-center md:gap-0 md:px-0 lg:justify-start lg:gap-3 lg:px-3",
                // Active state — was bg-primary-soft/10 (EAF0FF at
                // 10% opacity, effectively invisible on navy-900). Now
                // bg-white/[0.12] gives a real surface tone so operators
                // can see which item is current without relying purely
                // on the 2px left rail. Pending Remba review
                // (2026-05-23 external review §2.1).
                active &&
                  "border-l-2 border-primary bg-white/[0.12] pl-[10px] text-white md:border-l-0 md:pl-0 lg:border-l-2 lg:pl-[10px]",
              )}
            >
              <Icon key="icon" size={16} className="shrink-0" />
              <span key="label" className="flex-1 truncate md:hidden lg:inline">
                {item.label}
              </span>
              {showCommsBadge ? (
                <span
                  key="comms-badge"
                  aria-hidden="true"
                  className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-leasium-micro font-semibold leading-none md:absolute md:right-0.5 md:top-1 md:h-4 md:min-w-4 md:px-1 md:text-[9px] lg:static lg:h-5 lg:min-w-5 lg:px-1.5 lg:text-leasium-micro",
                    commsBadge!.urgent > 0
                      ? "bg-danger text-white"
                      : "bg-white/15 text-white",
                  )}
                >
                  {commsBadge!.urgent > 0
                    ? commsBadge!.urgent
                    : commsBadge!.total}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/5 px-3 py-3 text-xs text-leasium-slate-400">
        <button
          type="button"
          onClick={() => {
            setCheatsheetOpen(true);
            setMobileNavOpen(false);
          }}
          title="Keyboard shortcuts"
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-white/5 hover:text-white md:justify-center"
        >
          <span className="md:hidden lg:inline">Keyboard shortcuts</span>
          <kbd className="rounded border border-white/10 px-1 py-0.5 text-leasium-micro font-medium">
            ?
          </kbd>
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar — fixed on md+. Collapses to icon-only (w-16) at
          md, expands to full (w-60) at lg+. globals.css adjusts the body
          padding-left to match. Below md the sidebar is hidden and the
          hamburger opens a full-width drawer instead. */}
      <aside
        aria-label="Primary navigation"
        className="hidden md:flex md:fixed md:inset-y-0 md:left-0 md:z-30 md:w-16 md:flex-col md:bg-leasium-navy-900 md:text-white md:shadow-leasiumSm lg:w-60"
      >
        {sidebarContent}
      </aside>

      {/* Mobile drawer — only reachable below md (hamburger hides at md+). */}
      {mobileNavRender.shouldRender ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className={cn(
              "absolute inset-0 bg-leasium-navy-900/60",
              mobileNavRender.isClosing
                ? "animate-leasium-backdrop-out"
                : "animate-leasium-backdrop-in",
            )}
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
          <aside
            aria-label="Primary navigation"
            className={cn(
              "absolute inset-y-0 left-0 flex w-60 flex-col bg-leasium-navy-900 text-white shadow-leasiumLg",
              mobileNavRender.isClosing
                ? "animate-leasium-drawer-out-left"
                : "animate-leasium-drawer-in-left",
            )}
          >
            <div className="flex items-center justify-end px-2 pt-2">
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="grid h-11 w-11 place-items-center rounded-xl text-leasium-slate-300 transition duration-200 ease-leasium hover:bg-white/5 hover:text-white"
                aria-label="Close navigation"
              >
                <X size={16} />
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white/95 px-1 pt-1 shadow-[0_-8px_24px_rgba(16,24,40,0.08)] backdrop-blur md:hidden"
        style={{
          paddingBottom: "max(0.35rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="mx-auto grid max-w-md grid-cols-5 gap-0.5">
          {mobileBottomNavItems.map((item) => {
            const active = isNavActive(item);
            const Icon = item.icon;
            return (
              <Link
                {...shellLinkProps}
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                onMouseEnter={() => router.prefetch(item.href)}
                onFocus={() => router.prefetch(item.href)}
                className={cn(
                  "flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[11px] font-semibold leading-none text-muted-foreground transition duration-200 ease-leasium hover:bg-muted hover:text-foreground",
                  active && "bg-primary-soft text-primary hover:bg-primary-soft",
                )}
              >
                <Icon
                  key="icon"
                  size={17}
                  aria-hidden="true"
                  className="shrink-0"
                />
                <span key="label" className="max-w-full truncate">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      <header className="sticky top-0 z-20 border-b border-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2 min-[1600px]:max-w-none sm:px-4">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border-strong bg-white text-slate shadow-leasiumXs transition duration-200 ease-leasium hover:bg-muted md:hidden"
          >
            <Menu size={15} />
          </button>
          <div
            role="toolbar"
            aria-label="Workspace utilities"
            className="ml-auto flex min-w-0 max-w-full items-center justify-end gap-1 rounded-xl border border-border bg-white/90 p-1 shadow-leasiumXs"
          >
            {children ? (
              <div className="min-w-0 max-w-[44vw] border-r border-border pr-1 sm:max-w-xs sm:min-w-44 [&_select]:h-9 [&_select]:min-h-9 [&_select]:truncate [&_select]:rounded-lg [&_select]:border-0 [&_select]:bg-transparent [&_select]:px-2 [&_select]:text-sm [&_select]:font-medium [&_select]:shadow-none [&_select]:focus-visible:ring-0">
                {children}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCommandOpen(true);
              }}
              aria-label="Open search"
              title="Search (Cmd K)"
              className={headerUtilityInlineButtonClass}
            >
              <Search size={15} />
            </button>
            <button
              type="button"
              onClick={() => setCheatsheetOpen(true)}
              aria-label="Show keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              className={cn("hidden sm:inline-flex", headerUtilityButtonClass)}
            >
              <Keyboard size={15} />
            </button>
            <Link
              {...shellLinkProps}
              href="/notifications"
              aria-label="Open notifications"
              title="Notifications"
              className={cn(
                headerUtilityInlineButtonClass,
                pathname.startsWith("/notifications") &&
                  "bg-primary-soft text-primary hover:bg-primary-soft",
              )}
            >
              <Bell size={15} />
            </Link>
            <AppearanceToggle />
            {clerkConfigured ? (
              <div className="flex h-11 shrink-0 items-center pl-1">
                <OperatorUserControl />
              </div>
            ) : null}
          </div>
        </div>
        {shortcutPending ? (
          <div className="pointer-events-none fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-white px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-leasiumSm md:bottom-6">
            G… press a letter to jump ({shortcutLegend})
          </div>
        ) : null}
        {cheatsheetRender.shouldRender ? (
          <div
            onPointerDown={() => setCheatsheetOpen(false)}
            className={cn(
              "fixed inset-0 z-50 bg-leasium-navy-900/30 px-4 py-20 backdrop-blur-sm",
              cheatsheetRender.isClosing
                ? "animate-leasium-backdrop-out"
                : "animate-leasium-backdrop-in",
            )}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="keyboard-shortcuts-title"
              onPointerDown={(event) => event.stopPropagation()}
              className={cn(
                "mx-auto max-w-lg overflow-hidden rounded-2xl border border-border bg-white shadow-leasiumLg",
                cheatsheetRender.isClosing
                  ? "animate-leasium-modal-out"
                  : "animate-leasium-modal-in",
              )}
            >
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Keyboard size={17} className="text-primary" />
                <h2
                  id="keyboard-shortcuts-title"
                  className="flex-1 text-sm font-semibold text-foreground"
                >
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
                        <span className="text-foreground">
                          {shortcut.label}
                        </span>
                        <kbd className="rounded-md border border-border bg-white px-1.5 py-0.5 text-leasium-micro font-medium text-muted-foreground">
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
                    {gatedShortcutNav.map((entry) => (
                      <div
                        key={entry.key}
                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
                      >
                        <span className="text-foreground">{entry.label}</span>
                        <kbd className="rounded-md border border-border bg-white px-1.5 py-0.5 text-leasium-micro font-medium text-muted-foreground">
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
        {commandRender.shouldRender ? (
          <div
            onPointerDown={() => setCommandOpen(false)}
            className={cn(
              "fixed inset-0 z-50 bg-leasium-navy-900/30 px-4 py-20 backdrop-blur-sm",
              commandRender.isClosing
                ? "animate-leasium-backdrop-out"
                : "animate-leasium-backdrop-in",
            )}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="command-search-title"
              onPointerDown={(event) => event.stopPropagation()}
              className={cn(
                "mx-auto max-w-xl overflow-hidden rounded-2xl border border-border bg-white shadow-leasiumLg",
                commandRender.isClosing
                  ? "animate-leasium-modal-out"
                  : "animate-leasium-modal-in",
              )}
            >
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Command size={17} className="text-primary" />
                <h2 id="command-search-title" className="sr-only">
                  Command search
                </h2>
                <input
                  autoFocus
                  aria-label="Command search"
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
                {filteredActions.length > 0 ? (
                  <ul aria-label="Command actions" className="grid gap-0">
                    {filteredActions.map((action) => (
                      <li key={`${action.meta}-${action.label}`}>
                        <Link
                          {...shellLinkProps}
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
                      </li>
                    ))}
                  </ul>
                ) : null}
                {filteredActions.length === 0 ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    No matching action.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </header>
    </>
  );
}
