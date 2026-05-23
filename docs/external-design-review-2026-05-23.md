# Leasium Design Review — Web + Mobile Web

Reviewer: external (acting as graphic-design / product-design lead)
Date: 2026-05-23
Scope: production frontend at https://leasium.vercel.app, reviewed via source code (apps/web), design source-of-truth, and design governance log. Live-pixel pass was not possible from this environment (egress + no Chrome session). Findings should be cross-checked in browser before any change is shipped.
Audience: Temba (operator/founder) + Remba (UX sign-off).
Working assumption: internal-first for 6 months — bias toward operator speed, scannability, and data integrity over marketing aesthetics.

## TL;DR

The design system is well thought through. The source-of-truth document (Codex design SoT) is one of the better internal brand bibles I've read in a small-team SaaS: clear color tokens, real type scale, named status chips, copy rules, and an opinionated point of view ("Show the next action, not just the data" / "Nothing is applied until you approve it"). It deserves credit.

The implementation has drifted from that document in three structural ways that compound: navigation has roughly doubled in count, page files have become monolithic enough that they enforce monolithic UI, and the typographic hierarchy is collapsed to one mid-size weight. Each is small on its own. Together they produce the "everything is a flat row of section panels" feeling that operators will eventually call "noisy" without being able to name why.

The biggest wins, in order:

1. Cut primary nav from 13 to 7. Group communications. Make Comms / Notifications / Contractors not all top-level.
2. Restore the typographic ladder. Page titles should be 28–32px, not 20px. Section titles should be 18–20px, not 15px.
3. Break the four monolithic page files into composed sections. The shape of the code is dictating the shape of the UI.
4. Rework the dashboard so the first viewport answers one question ("What needs me right now?") instead of six metric cards.
5. Add proper skeletons and replace the "... Loading" copy across Properties / Billing / Insights / Notifications.

The rest is polish.

---

## First impression (≈2 seconds)

**What draws the eye first (desktop, signed-in operator landing on `/`)**: the six-up metric card row, because six equal-weight tiles in a single horizontal band are the visually heaviest thing on a 1440px viewport.

**Is that correct?** Almost. The dashboard's stated job is to surface what needs attention today (the "Daily command center"). The command center exists in the code and sits *above* the metric row, but the metric grid out-shouts it because (a) it has six items vs. command-center rows, (b) the cards use chips + counts + colored icons + "next action" copy, and (c) the section heading above them is only 20px. The intended hierarchy is right; the visual weights aren't.

**Emotional reaction**: "competent, calm, a lot." This is the right family of adjectives for an internal lease tool. It's not the right family for the marketing site, which doesn't really exist yet — see §10.

**Is the purpose immediately clear?** Yes, on Dashboard. Less so on `/properties` and `/operations`, where the page is essentially a long scroll of section panels with similar visual weight; the operator has to read to find the next action.

---

## 1. Critical findings

### 1.1 Navigation has drifted from the spec — 13 items, not 7

**Where**: `apps/web/src/components/app-shell.tsx` `navItems`.

The Codex SoT specifies 8 items; the 2026-05-21 governance update reduced to 7 (Dashboard, Smart Intake, Portfolio, Work, Billing, Insights, Settings). The shipped sidebar carries 13: Dashboard, Smart Intake, AI Inbox, Properties, Tenants, Work, Contractors, Comms, Billing, Insights, Statements, Portfolio QA, Settings.

This is the single highest-leverage fix in the review. Effects:

- The sidebar becomes a list to scan rather than a map of the product. Operators stop reading after the first 6–7 items.
- The G-then-letter shortcut overlay ("press D/P/T/O/I/B/N/Q/S") is correspondingly long.
- Mobile is worse: the drawer becomes a 13-row scrolling list at 240px wide — that is 63% of a 380px viewport, with no IA simplification for touch.

**Recommendation** (in priority order, all reversible):

- Fold `AI Inbox` into `Smart Intake` (they share the document-intake premise; an "Inbox" tab inside Smart Intake reads better than two siblings).
- Fold `Contractors` and `Comms` under `Work`. Contractors are a directory in service of work assignment; Comms is the outbound side of the same surface. Use tabs or a "People & messages" subnav inside `/operations`.
- Fold `Statements` inside `Billing` as a tab. They're two ends of one workflow.
- Move `Portfolio QA` to command palette only (the governance doc already considered this; do it).
- Collapse `Properties` + `Tenants` into `Portfolio` with two sub-views, the way the 2026-05-21 simplification intended.

Target list: Dashboard / Smart Intake / Portfolio / Work / Billing / Insights / Settings. (7.)

Mark the Notifications bell as a header utility, not a nav item.

### 1.2 Monolithic page files are dictating monolithic UI

**Where**:

- `apps/web/src/components/dashboard.tsx` — 4,556 lines
- `apps/web/src/components/property-workspace.tsx` — 6,120 lines
- `apps/web/src/app/settings/page.tsx` — 4,517 lines
- `apps/web/src/app/operations/page.tsx` — 4,694 lines
- `apps/web/src/app/billing-readiness/page.tsx` — 2,675 lines

When a page is a 4–6k line file, every author reaches for `<SectionPanel>` as the container of last resort. The result is what you see in the rendered code: each surface is a vertical stack of similarly-shaped white cards with similarly-weighted titles. Visual hierarchy degenerates into "card after card."

This is a design problem, not just an engineering one — the code shape is enforcing the UI shape.

**Recommendation**: extract each page into a directory of named section components (e.g. `dashboard/CommandCenter.tsx`, `dashboard/Metrics.tsx`, `dashboard/SmartIntakeCard.tsx`, `dashboard/ActivityFeed.tsx`). Once sections are isolated, three things become easier:

- Differentiated styling: command center can drop the card chrome and use a hero band; metrics can become tighter; activity feed can use a quieter container.
- Loading state ownership: each section owns its own skeleton (see §1.5).
- Density tuning: a section that's been underused can be deleted without untangling 4,000 lines.

Aim for files under 400 lines. Anything longer is, in practice, a small app.

### 1.3 Typographic hierarchy is collapsed

**Where**: `apps/web/src/components/ui.tsx`.

| Element | Spec (SoT §4) | Shipped | Gap |
|---|---|---|---|
| H1 (page) | 36 / 44 / 700 | `PageHeader` uses `text-xl font-semibold` → 20 / 28 / 600 | **−44%** |
| H2 | 30 / 38 / 700 | not present as a reusable style | — |
| H3 (section panel) | 24 / 32 / 650 | `SectionPanel` title `text-[15px] font-semibold` → 15 / 20 / 600 | **−38%** |
| Body | 16 / 24 | mostly 14 (`text-sm`) | one notch small |

Because everything sits in a narrow band between 12 and 16px, the only signal of importance is the chip colors next to a heading. That's why the metric row outweighs the command center in §First impression.

**Recommendation**: introduce three reusable headings — `PageTitle` (28–32px / 700, the operator-mode version of the spec H1), `SectionTitle` (18–20px / 650), `RowTitle` (15px / 600 — what's there today, repurposed for table rows and small cards). Use them consistently. Page titles should win the first viewport without color emphasis.

The pre-2026-05-21 typography update (Dashboard rows at 15/20) was a good calibration for *row* text. The mistake is using the same calibration for *page* and *section* titles.

### 1.4 Public onboarding has been retired to a redirect screen

**Where**: `apps/web/src/app/onboarding/[token]/page.tsx`.

This page is the first thing a brand-new tenant sees from an agent's email. Today it's a "Your onboarding has moved into your Leasium account" stub that bounces them to the tenant portal. Issues:

- A tenant who has never had a Leasium account reads "moved into your Leasium account" as if they should already have one.
- The page is the only point in the journey where Leasium can establish trust before asking the tenant for documents. It currently establishes none — no property/tenant context, no "we're acting for [agency]," no expected next step.
- The 2026-05-20 Remba note already called this out: "Public onboarding should identify the tenant/business in the first viewport and provide clearer due/expiry reassurance."

**Recommendation**: either (a) restore the public onboarding form with the property/unit/lease context the portal collects, or (b) make this redirect page itself the first-impression surface — show "You've been invited to onboard with [agency/landlord] for [property]," show what's coming, then offer the portal button. Don't ship a redirect as the tenant's first impression.

### 1.5 Loading states are still "... Loading" strings in too many places

The 2026-05-20 governance entry already flagged this and partial fixes shipped, but a grep across the affected files shows the substring "Loading" used as user-facing copy in dozens of spots in `dashboard.tsx`, `operations/page.tsx`, `notifications/page.tsx`, `billing-readiness/page.tsx`.

The problem isn't "you forgot a skeleton." It's that "Loading" appearing inside a placeholder card is the *least* informative thing you can render. The user has no idea whether the system is slow, the data is empty, or the network failed.

**Recommendation**: replace text-string loaders with section-level skeletons that mimic the layout of the eventual content (gray bars where rows will be, gray squares where chips will be). For the dashboard metric row specifically, render the cards with stable prior-known values and a small "Refreshing" badge in the corner — the dashboard already does this for the page-level refresh state; pull the same pattern down to each card. Treat any place the word "Loading" appears in user-visible copy as a backlog item.

---

## 2. Sidebar + app shell

### 2.1 Active-nav state is functionally invisible

`bg-leasium-blue-soft/10 text-white border-l-2 border-primary pl-[10px]`

The intent (from SoT) was "soft blue tint or blue left rail." `EAF0FF` at 10% opacity against the navy-900 sidebar is a tint of roughly 1–2% perceivable change. The active state is doing almost all its work with the 2px left rail and the title-vs-300 text color contrast.

**Recommendation**: drop the opacity tint, replace with a real surface tone — e.g. `bg-white/8` for hover, `bg-white/12` plus the left rail for active. Or use a small inset highlight (`shadow-inset` style) so the active row reads as inset/raised rather than tinted.

### 2.2 Brand block in sidebar loses "automated"

Sidebar header shows `Leasium / Lease operations`. The tagline in SoT is "Lease operations, automated." Truncating to "Lease operations" loses the differentiator and reads like a tagline that ran out of room.

**Recommendation**: either show the full tagline (`Lease operations, automated.`) on `lg+`, or drop the tagline entirely and let the wordmark do the work. The half-tagline isn't doing brand work or space work.

### 2.3 Header right cluster is 4–5 controls on mobile

`Hamburger + (children slot, often a search box) + Search + Keyboard + Bell + UserButton`. Keyboard hides on sub-`sm`, but Search stays full size on mobile next to Bell next to Avatar. The header `flex-wrap` causes the children slot to reflow below the right group at narrow widths.

**Recommendation**: on mobile, the search icon should open the same Cmd-K palette modal — keep one entry point. The Bell can move into the user menu. Net result: hamburger left, page title center, single avatar right. That's the productivity-app convention for a reason.

### 2.4 Sidebar gutter math (`pl-60` on body) breaks down at edges

`globals.css` adds `padding-left: 240px` on body when AppHeader mounts. Page content inside the header uses `max-w-7xl` (1280px) with a centering `mx-auto`. Between 1280 and ~1600px, the page content is centered inside the *remaining* width, which means it doesn't optically align with the sticky header on common laptop sizes (1366, 1440, 1536).

**Recommendation**: either remove the `max-w-7xl` constraint on header inner (let it span the full content area), or apply the same constraint to page bodies via a shared `<ContentColumn>` wrapper. Right now header and page disagree about where the column starts.

---

## 3. Dashboard

### 3.1 Six-up metric grid drowns the command center

`section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"` renders six metric cards in a row at 1280+. On a 1440px viewport with the 240px sidebar, each card is ~165px wide. Inside that 165px the card carries: icon + label + count + chip + 2-line "next action" sentence. The text wraps; chips get pushed; cards become inconsistent heights.

The card content is great. There's just too much of it competing.

**Recommendation**: reduce to 3–4 metric cards on the dashboard, picked by recency: Needs review / Billing blockers / Operations / Onboarding. Promote the most operational two to a "first viewport hero" treatment (larger, with a primary action button). Move "Properties / Tenants" counts into a small secondary strip (one line, no cards) — they're navigational, not operational.

The command center is already structurally what the dashboard wants to be. Let it have the first viewport without competing chips.

### 3.2 Section ordering should be reconsidered

Current order: Daily command center → Metric grid → Upcoming lease events → Ask Leasium → Activity feed → Smart Intake panel.

The Smart Intake drop zone is at position 6. But Smart Intake is explicitly framed throughout the SoT as the product wedge ("hero workflow"). On a fresh-data day with nothing in the command center, the operator scrolls past five sections before they can drag a document in.

**Recommendation**: command center first, Smart Intake drop zone second (compact form — drop target + last 3 in review queue), metrics third, activity / lease events / Ask Leasium below the fold. The bias is: anything an operator *does* should be above the fold; anything they *read* can be below.

### 3.3 "Ask Leasium" placement is too low

Same logic. Ask Leasium is a differentiating feature with strong source-citation behavior — but it sits below the metrics + events panel. Most operators won't scroll to it on day 2.

**Recommendation**: surface a single-line "Ask Leasium" input in the dashboard header strip (the existing `children` slot in `AppHeader`). Treat it as a global affordance, not a page section. The expanded result panel can still live below.

---

## 4. Tables, density, and the "everything is a card" problem

Across `/properties`, `/operations`, `/tenants`, `/billing-readiness`, the dominant container is `<SectionPanel>` — white card, 1px slate-150 border, ~16px radius, ~16px padding. Stacked vertically, four or five panels make a single 1440px viewport. Each panel looks like every other panel.

This is the inverse of what dense lease operations want. SoT §8: "Tables and forms must prioritize readability over visual drama" and "Use clean tables, saved filters, sticky columns, compact chips, and fast keyboard search."

**Recommendation**: introduce a second container archetype — a `<Surface>` that has no card chrome (no border, no radius, no shadow), only an internal heading and a divider rule. Use it for the *body* of a workspace page (tables, lists, dense data). Reserve `<SectionPanel>` for *aside* content (Ask Leasium, recent activity, Smart Intake upload). The visual rhythm becomes "page is one canvas, sections are headings on that canvas, and there are a few inset cards for special asides." Right now every section is an aside.

This is also the single change that would make the operator pages feel "less noisy" without removing any actual content.

---

## 5. Status chips and color tokens

`ui.tsx` `StatusBadge` hardcodes hex values inside the component:

- success: `text-[#027A48]` on `bg-leasium-success-soft`
- warning: `text-[#B54708]`
- danger: `text-[#B42318]`

These are good values (they match the SoT chip palette) but they're hex literals, not token references. The Tailwind config doesn't expose them as named utilities, so any future palette tweak requires touching the hex in three components.

**Recommendation**: extend the Tailwind theme with `leasium.success-strong: #027A48`, `leasium.warning-strong: #B54708`, `leasium.danger-strong: #B42318` (these are the WCAG-AA-on-soft-background equivalents of the base semantic colors). Replace the hex literals. Apply the same shape to `chips` token in SoT JSON — it currently doesn't separate "fill color" from "text color."

Secondary chip issue: `text-leasium-blue-hover` for the primary chip text — that's the *button hover* color being reused for chip text. They're the same value today; in a year they will diverge. Same recommendation: name the chip-text color separately.

---

## 6. Forms and inputs

Inputs use `min-h-11` (44px) — correct, meets WCAG. Focus state uses `ring-2 ring-primary/15` plus `border-primary`. Good.

Issues:

- **Field labels**: the `<Field>` helper uses `font-medium text-foreground` for the label and `text-xs text-danger` for error. The error text drops to 12px — that's the smallest legitimate text in the product. WCAG passes, but it telegraphs "this is unimportant" exactly when it's most important. Match label and error sizes (both 14px), differentiate by color and an inline icon.
- **No help/hint affordance**: `<Field>` accepts label + error + children but no `description` or `hint`. Operators are working with extraction confidence, source clauses, draft status — they need help text often. Adding `description?: string` to Field would let the SoT trust line ("Nothing is applied until you approve it") attach to the relevant input cluster instead of being a separate paragraph.
- **`Select` is the native `<select>`**: that's fine for an internal tool, but on macOS the native select doesn't honor the rounded corners or focus ring shown in the design. Consider a styled menu (Radix Select) for the operator-facing surfaces only — tenant portal keeps native for accessibility.

---

## 7. Tenant-facing surfaces

### 7.1 Tenant portal first viewport

Reviewed via `tenant-portal-content.tsx`. The content is calm and informative; the layout is grid-based with sensible sections. The standout problem is consistent with §4: every section is a card, which on a public-facing surface reads as "admin tool." Tenants will read this as forms, not a portal.

**Recommendation**: keep the cards for the portal — it's the right surface chrome for a logged-in user — but lead with a single, human first-viewport block: "Welcome, [Tenant Name]. Here's what's next." Below it, the section cards. Today the page opens with the section list at full visual weight, which is more "select an item to act on" than "we're glad you're here."

### 7.2 Access gate

`apps/web/src/app/access/page.tsx` shows three identifying elements stacked: Leasium logo + wordmark, an italicized tagline, then a "Private beta" card with a lock icon. That's three trust-signaling blocks doing the same work.

**Recommendation**: collapse to two. Logo+wordmark+tagline is one block; the password field can sit immediately below without a "Private beta" intermediary card. The lock icon can attach to the password label instead of needing its own card.

### 7.3 Public onboarding redirect (already covered in §1.4)

---

## 8. Mobile web

Reviewed via code; no live device pass. Findings are structural, not pixel-level.

### 8.1 Breakpoint is `lg` (1024px) — tablet falls off

The sidebar swap happens at `lg` (1024px). iPads at 768/810, Android tablets in the 800–900 range, and landscape iPhones Pro Max all sit below `lg`. They get the mobile hamburger experience even though they have room for a sidebar.

**Recommendation**: introduce a `md` breakpoint where the sidebar collapses to icon-only (48px wide) instead of disappearing. Tablet operators keep navigation visible at all times. Below `md` (mobile), full drawer behavior.

### 8.2 Drawer is a 240px slab over 63% of a 380px phone

When the operator opens the menu on phone, a navy-900 slab covers most of the viewport carrying 13 list items at default size. There's no IA simplification for mobile.

**Recommendation**: on mobile only, surface the top 5 destinations (Dashboard, Smart Intake, Work, Billing, Notifications) as a bottom tab bar with iOS/Android conventions — fixed, 56px tall, always visible. The drawer becomes a secondary list ("More") accessed from a "More" tab. Internal lease admin will be done from desktop for the foreseeable future; the mobile surface is the one operators check on the road, not the one they configure from.

### 8.3 Header reflow on narrow widths

The header uses `flex-wrap` with `order-last` for `children`. On a 360–390px viewport, the search box wraps to a second row below the right-cluster of buttons. The visual result is a two-row sticky header eating 88px of vertical space.

**Recommendation**: at sub-`sm`, hide the children slot entirely — operators on phone use the Cmd-K palette via the search button. One-row header, more vertical real estate for content.

### 8.4 Tap targets on chip-style filter rows

In the Notifications page, filter pills (`noticeFilters`, `digestFilters`, `channelFilters`) are rendered as small rounded pills. The hit target of a pill with `px-2.5 py-1` and a 12px label is approximately 24px tall — below the 44px tap target the rest of the system honors.

**Recommendation**: enforce a `min-h-9` (36px) on filter pills site-wide; consider a separate filter group component (a real segmented control) on mobile to avoid the row becoming a wrap-fest of small targets.

---

## 9. Accessibility (quick AA pass — code-level)

- **Focus rings**: global `outline: 2px solid var(--leasium-blue)` is present and well-applied. Good.
- **Color-only signaling**: status chips pair color + text labels — passes.
- **Min target 44px**: respected on buttons and inputs, broken on filter pills and on the small icon buttons inside `SectionPanel` actions (those are ad-hoc; standardize).
- **Contrast**: muted-foreground `#667085` on `bg-muted/25` (~`#FAFBFC` effective) passes AA for body (5.3:1). On `bg-muted` solid (`#F2F4F7`) it's 4.6:1 — borderline. Audit any chip text using this color on a non-white background.
- **Hex literals bypassing token system**: see §5.
- **Reduced motion**: SoT calls for `prefers-reduced-motion` support; no evidence in CSS that it's honored. Add a global `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0.01ms !important; } }`.
- **Form labels**: `<Field>` ties label and input via the `<label>` wrapper. Good.
- **Heading levels**: PageHeader uses `<h2>` for page title, SectionPanel uses `<h3>`. There's no `<h1>` on most pages — screen readers won't get a clean document outline.

**Recommendation**: PageHeader title should be `<h1>`. SectionPanel should remain `<h2>`. Sub-section titles inside section panels should be `<h3>`. Today the levels are off by one.

---

## 10. Brand / marketing surfaces

This is the gap the review is most cautious about, because per CLAUDE.md the project is internal-first for six months. But it's worth naming:

- There is no public marketing site reviewed in this scan. The closest public surfaces are the access gate, the sign-in page, the retired onboarding stub, and the tenant portal. None of them carry the brand position described in SoT §1–2.
- The SoT contains extensive marketing copy (hero headline, problem statement, workflow section, pricing direction) that has no implementation surface. That's fine — defer until external launch — but it should be tagged as "deferred" in the roadmap so it doesn't read as "missing." Right now it reads like a spec with no owner.

**Recommendation**: keep the SoT marketing sections, add a `Status: deferred until external launch` line at the top of each, so future Claude / Codex sessions don't try to "complete" them prematurely.

---

## What works well (worth protecting)

- The color system. The navy-900 sidebar / soft-blue active hint / surface white / slate text ladder is correct and not over-designed. Don't add gradients or "depth."
- Status chip semantics — `ready / needsReview / blocked / awaitingTenant / draft / synced / overdue / upcoming / automated` is the right vocabulary, mapped to the actual workflow states. Many products ship 4 chips and improvise the rest.
- The review-first language is doing real work. "Nothing is applied until you approve it" appearing near apply buttons, and the source-citation behavior in Ask Leasium and Smart Intake, are the product's competitive moat as much as the data model is.
- Cmd+K palette and G-then-letter shortcuts — appropriate for an operator tool. Keep these even when reducing nav count.
- Empty states. SoT §19 ("every empty state should teach") is largely followed in code. EmptyState component is small and well-shaped.
- Activity feed grouping (Today / Yesterday / Earlier this week / Older). Quietly excellent. Don't change it.
- Geist via `next/font` with variables. Modern, fast, doesn't FOUT.

---

## Priority recommendations

If the next two weeks of design work were prioritized as a top-five list:

1. **Cut primary nav from 13 to 7** (§1.1). Highest leverage, smallest code change. One commit.
2. **Restore typographic hierarchy** (§1.3). New `PageTitle` (28–32px) and `SectionTitle` (18–20px) components; replace usages. One commit.
3. **Split the four monolithic page files** (§1.2). Mechanical refactor; doesn't change pixels in v1. Two to three commits. Unlocks future design work that's currently blocked by file size.
4. **Replace metric grid with operational hero** on Dashboard (§3.1). Reduce six cards to two prominent + two secondary. Promote command center to first viewport. One commit.
5. **Public onboarding redirect → first-impression page** (§1.4). Smallest user-visible change; biggest tenant-trust improvement. One commit.

The rest is polish work and can land opportunistically: skeletons (§1.5), active-nav surface tone (§2.1), mobile bottom-nav (§8.2), accessibility heading levels (§9), chip token cleanup (§5).

---

## Mapping back to existing governance

For each item above, the relevant Remba follow-up in `docs/design-governance.md`:

- §1.1 → extend the 2026-05-21 nav simplification entry; codify the 7-item target.
- §1.2 → new entry: "Page-file size policy — extract dashboard/property-workspace/settings/operations into composed sections; cap files at ~400 lines."
- §1.3 → new entry: "Typographic hierarchy restore — introduce PageTitle / SectionTitle / RowTitle components matching SoT scale."
- §1.4 → reopen the 2026-05-20 "Public onboarding should identify the tenant/business" item.
- §1.5 → extend the 2026-05-20 loading-state entry.
- §3.1 → relates to the 2026-05-21 Dashboard command center entry.
- §4 → new entry: "Container hierarchy — distinguish workspace `<Surface>` from aside `<SectionPanel>`."
- §8 → new entry: "Mobile/tablet IA — sidebar collapse at md, bottom-nav at sub-md."
- §9 → new entry: "Heading levels — PageHeader as h1, SectionPanel as h2."

Treat the whole set as `pending Remba review` per CLAUDE.md §2.2.

---

## Final note on scope

This review was done without browser access to the live production site and without a Figma file. Pixel-level findings (exact line-height, exact contrast ratios on rendered components, animation feel, real-device touch behavior) should be re-checked in a live pass before any major change ships. The structural findings (§1.1–§1.5) hold regardless of the live pass.

If a follow-up live pass is wanted, the most informative views to capture in the order they'd help most: Dashboard at 1440/375, Properties at 1440/375, Operations at 1440/375, Tenant portal at 1440/375, Smart Intake at 1440, Notifications at 1440. Six screenshots at two viewports each (12 images) would be enough to upgrade this review from "structural" to "pixel-level."
