# Nav Pattern Research — Top Bar vs Left Sidebar

Date: 2026-05-23
Status: pending Remba review (evidence-only — no design change proposed).

## Why this note exists

Tier 1 (a) v1 shipped 2026-05-22: Leasium now uses a 240px fixed left
sidebar (navy `#0B1020`, brand at top, icon + label per module, G+X
shortcut chips, hamburger drawer below `lg`). See
`product-roadmap.md` Tier 1 (a) and `ux-review-2026-05-22.md`.

This note captures the UX evidence behind that choice so Remba can
sign it off with the same evidence the original UX review used, and so
future maintainers can see when the decision should be revisited
rather than re-debated.

This is not a proposal to change the nav. The sidebar is the right
call for Leasium as of today. The note explains why.

## TLDR

Pattern choice is driven by item count and depth, not aesthetics:

- ≤7 flat destinations, content-led site → top bar.
- >7 destinations OR any nested structure → left sidebar (collapsible).
- Big app with distinct modes → both (top bar for modes, sidebar
  inside a mode).

Leasium has 9 top-level modules (Dashboard, Smart Intake, Properties,
Tenants, Work, Billing, Insights, Portfolio QA, Settings) and several
already have nested workspaces (property workspace tabs, billing run
tabs, settings sections). That puts Leasium firmly in sidebar
territory.

## Evidence

Top bar
- Best for: marketing sites, content-led apps, simple products with
  4-7 destinations.
- Pros: less visual weight, more horizontal canvas for content,
  familiar pattern from the web, faster scan when items are few.
- Cons: hits a hard ceiling around 7 items before it overflows or
  hides behind a `More`/hamburger, weak for nested hierarchies,
  degrades fast on narrow viewports.

Left sidebar
- Best for: dashboards, admin tools, SaaS workspaces, anything with 8+
  destinations or 2+ levels of hierarchy.
- Pros: scales vertically (lists are basically infinite), supports
  grouping and sub-nav cleanly, persistent context (user always sees
  where they are), collapsible to icons to claw back canvas, room for
  shortcut chips (`G X`) without crowding content.
- Cons: steals horizontal space (usually 200-280px), more visual
  noise on first impression, can feel `enterprisey` if styled wrong.

Hybrid (top bar for modes, sidebar inside a mode)
- The pattern that mature SaaS converges on: Linear, Notion, Stripe,
  GitHub all use a sidebar for in-app destinations and reserve the
  top bar for utility/account/search.

## What the research literature says

- NN/g (Pernice/Whitenton): vertical menus scan slower per item but
  support more items before cognitive overflow. Horizontal menus are
  faster for small sets but degrade fast once you hide things behind
  `More`.
- Baymard: hidden navigation (hamburger on desktop) measurably reduces
  discovery of secondary destinations vs. a persistent sidebar.
- Linear/Stripe/Notion/Vercel: all three have ≥8 primary destinations
  and all three use a left sidebar with a slim top utility row. This
  is the comparison set the 2026-05-22 UX review benchmarked Leasium
  against.

## Why sidebar fits Leasium specifically

- 9 primary modules today, growth direction is more not fewer (Tier
  2/3 lines up an Inbox, Notifications already shipped, Communications
  is a Later Modules backlog item). A top bar would overflow within
  one tier.
- Multiple modules already have sub-navigation (Property workspace
  tabs, Billing Readiness tabs, Settings sections, Operations tabs).
  Sidebar collapses naturally into a parent-child IA; top bar does
  not.
- `G X` keyboard shortcuts (Tier 2 (h)) read as a vertical column on
  a sidebar, with the chip aligned to its label. Top bar can't show
  the chip-to-label pairing without crowding.
- Density target: Leasium is an operator tool, not a marketing
  surface, so the 240px gutter cost is acceptable (laptop-first
  audience). Internal-first 6 months further reduces the polish/brand
  tradeoff.
- Operator persistence: SKJ property managers will be in Leasium for
  hours per day. A persistent sidebar keeps `where am I in the app`
  ambient at zero cognitive cost — top bar requires a glance up every
  time.

## When this decision should be revisited

Treat the sidebar choice as durable unless one of these flips:

- The primary nav drops to ≤6 items AND no module has sub-navigation
  (unlikely — direction is the opposite).
- Mobile becomes the primary surface and the hamburger drawer is
  measurably hurting discovery (operator audience is desktop; tenant
  portal already has its own narrower IA and shouldn't share the
  operator sidebar).
- Remba review flags that the navy sidebar is overwhelming against
  the soft-grey content area and the lift can't be solved with
  contrast/density tweaks. In that case the answer is probably
  collapse-to-icons by default, not switch to top bar.

## Remba review focus

When reviewing the live sidebar, the questions worth answering:

- Is the navy `#0B1020` against the soft-grey content area too high
  contrast on first viewport, or does it correctly anchor attention?
- Should the top bar keep stickiness now that the sidebar already
  anchors navigation? Tier 1 (a) v1 leaves this open.
- Does the hamburger drawer below `lg` discover the same destinations
  reliably, or do we need to keep an always-visible top utility row
  on tablets?
- Should the sidebar collapse to icons by default once the operator
  is `inside` a workspace (similar to Notion's behaviour), or stay
  expanded?

## Sources

- Nielsen Norman Group: `Horizontal Attention Leans Left` (Pernice),
  `Top Tasks` (Whitenton), various menu-design articles.
- Baymard Institute: navigation usability benchmarks (hidden vs
  persistent navigation).
- Direct comparison set: Linear, Stripe, Notion, Vercel, GitHub
  (all sidebar-led for in-app navigation as of 2026).
