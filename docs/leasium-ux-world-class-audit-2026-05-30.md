# Leasium World-Class UX Audit & Gap Plan — 2026-05-30

Goal set by Temba: not "good enough for MVP." The bar is *"this is the
easiest product I've ever used"* — speed and price to market on top of a UX
that rivals the best in the world. This document is the research + answers
pass to agree on **what** to fix before writing the code.

## TL;DR — the honest verdict

Reframe the benchmark first. Google/Facebook are consumer-attention products;
they are the wrong north star for a dense, decision-heavy operator workspace.
The right bar — the products operators call "the easiest I've ever used" — is
**Linear, Stripe, Ramp, Mercury, Vercel**. That is who Leasium has to feel
better than.

Measured against that bar:

- **The visual craft is already B+/A-.** Token system (Untitled-UI-grade
  palette), AA-compliant chips, consistent radii/shadows/motion tokens,
  real skeletons, real empty states, genuine mobile card/disclosure
  patterns, zero horizontal overflow, zero console errors. Most "MVP" SaaS
  never gets here. Credit where due.
- **The gap to world-class is not in the pixels of any one component. It's
  in FEEL: perceived speed, editorial focus, and flow.** This is exactly the
  axis Linear/Stripe/Ramp win on — and it is achievable on this foundation
  without a redesign.

So the plan is not "rebuild the UI." It's five targeted campaigns that convert
a well-built app into one that feels effortless.

## Method (so the findings are trustworthy)

- Live, signed-in audit of `leasium.ai` as `temba@skjcapital.com` (SKJ),
  desktop (1280) + iPhone-13, all seven core routes. Full-page screenshots
  under `output/playwright/live-audit/`.
- Forensic native-resolution teardown of the command center, metric strip,
  sidebar, and property table.
- Token-level WCAG contrast math from the real design tokens (not eyeballed).
- Current Silicon Valley best-practice research (citations at the end):
  Linear's speed model, perceived-performance techniques, B2B dashboard
  density principles, premium-polish heuristics.

---

## Gap 1 — Perceived performance: the app waits; world-class never does

**Principle.** Users judge speed by how fast the interface *reacts*, not how
fast the server responds. Linear's entire reputation is built on optimistic,
local-first UI with **no spinners** — "there is nothing to wait for." Skeletons
beat spinners; stale-while-revalidate serves cached data instantly; prefetch-
on-intent makes navigation feel pre-loaded.

**Where Leasium is now (evidence).**
- The signed-in audit shows every route settling in **13–15s**, with
  `GET /api/v1/comms/queue/counts` the slowest request on *every* page at
  **6.5–8.1s** — it runs the full eight-scanner queue scan just to render the
  sidebar "7" badge. (Frontend mitigation already applied this session:
  `refetchOnWindowFocus:false`, `staleTime` 60s→5min in `app-shell.tsx`.)
- Navigation re-fetches per route; the app reads as "loading" on each hop
  rather than instant.
- The dashboard-overview accelerator helped first paint, but the model is
  still request→wait→render, not render→sync.

**What world-class would do here.**
1. **Server-side: make `/comms/queue/counts` actually cheap** (the #1 latency
   item) — count-only queries or a ~60s per-entity cached count. Highest
   single snappiness win.
2. **Stale-while-revalidate everywhere** — React Query already caches; show
   the last-known data instantly on return to a route and revalidate in the
   background, so revisits are zero-wait.
3. **Prefetch on intent** — prefetch a route's primary query on nav-link hover/
   focus (the operator's mouse telegraphs intent ~200ms early).
4. **Optimistic mutations** — approve / assign / mark-reviewed should update the
   UI immediately and reconcile on response (keeping the review-first provider
   guardrails: optimism is for local state, never for firing provider calls).
5. **Kill spinners in favour of skeletons** on any remaining full-screen waits.

This is the biggest lever on "easiest product ever used," and the one Temba
already flagged as the live concern.

## Gap 2 — Editorial focus: the dashboard shows everything at once

**Principle.** B2B operators optimise for *efficiency*, not delight — but that
means **one story at a time** and **progressive disclosure**: 5–7 primary
signals, high-level first, detail on request. Cognitive load is the enemy.

**Where Leasium is now (evidence).** The dashboard renders ~10 stacked sections
and shows the **same status numbers three times** within one screen:
- the ranked command-center list (#1 Billing 43, #2 Operations, #3 Onboarding),
- the right-rail summary (Smart Intake 0 / Billing 43 / Onboarding 2 /
  Operations 27),
- the metric strip (Operations 27 / Billing 43 / Needs review 0 / Blocked 0).

Then Smart Intake, Needs attention, Events, Billing updates, Onboarding,
Upcoming lease events, Ask Leasium, and a very long Recent activity feed.
Everything competes; nothing is clearly *the* next action. On the Needs-
attention and Events lists, **every row is an amber "Tomorrow" chip** — when
everything is urgent, nothing reads as urgent.

**What world-class would do here.**
1. **Pick one hero.** Lead with a single "Here's what needs you now" block (the
   ranked list is the right candidate) and demote the duplicated summaries —
   delete the right-rail number list OR the metric strip, not both-and.
2. **Differentiate urgency** — group by Today / This week / Later, or vary chip
   tone by real due distance, so "Tomorrow" stops being wallpaper.
3. **Progressive disclosure** — collapse Events/Billing updates/Activity behind
   "show more" or move to their owning surfaces; the home screen should fit the
   decision, not the database.
4. **Recent activity** belongs as a right-rail digest or a separate tab, not a
   50-row wall that dominates the page's vertical space.

## Gap 3 — Flow & keyboard-first: good bones, not yet a flow state

**Principle.** Linear users navigate the entire app without the mouse —
`C` to create, `Cmd-K` everywhere — producing a flow state that *is* the speed.

**Where Leasium is now.** There's a Cmd-K palette and `G`-prefixed nav
shortcuts plus a "Keyboard shortcuts ?" affordance — a strong start most apps
lack. But the core operator loops (review → approve, triage queue, assign work)
still lean mouse-first, and there's no per-row keyboard navigation
(j/k + enter) on the queues/lists where operators spend their day.

**What world-class would do here.** Make the high-volume loops fully
keyboard-drivable: arrow/j-k to move through queue rows, enter to open, a single
key to approve/assign/waive, `Esc` to back out. This is where solo-operator SKJ
gets disproportionate speed.

## Gap 4 — Motion & microinteraction polish: the "expensive feel"

**Principle.** Premium perception comes from tiny, fast, *consistent* feedback
on every state change — and enterprise buyers read interface polish as a proxy
for product maturity.

**Where Leasium is now.** Motion tokens exist (150/200/300ms, ease curves) and
drawer/modal animations are wired. But feedback is uneven: button press states,
optimistic row updates, toast/confirmation patterns, and list enter/exit
transitions aren't applied consistently across surfaces.

**What world-class would do here.** A single interaction-feedback pass: uniform
hover/active/focus states on every interactive element, a consistent toast/
inline-confirm pattern for every mutation, subtle list item enter animations,
and reduced-motion honoured throughout (the escape hatch is already in
globals.css).

## Gap 5 — Component punch-list (smaller, high-craft refinements)

Concrete, low-risk, visible-quality fixes found in the teardown:

| # | Finding (evidence) | Why it matters | Fix |
|---|---|---|---|
| 5.1 | Property table shows **two columns of "-"** (empty Area/Parking) on every row | Two dead columns = noise + wasted width; reads unfinished | Hide empty columns, or fold into row meta until populated |
| 5.2 | Owner-tag chips render literal `->` chains, truncated mid-word ("Gorilla Rus!") | Engineer-y, not premium; loses the full chain | Chevron glyph + tooltip/expand for full ownership path |
| 5.3 | "Tomorrow" amber chip repeats down whole lists | Urgency signal flattens to wallpaper | Group by date / vary tone by real due distance (see Gap 2) |
| 5.4 | Redundant chain-link icon beside "Open billing readiness" links | Visual noise; link text already implies nav | Drop the icon or use one consistent affordance |
| 5.5 | Zero-state chips inconsistent: "Empty" (neutral) vs "Clear" (green) for the same 0 | Inconsistent vocabulary for the same meaning | One zero-state convention across metric cards |
| 5.6 | Property rows are tall / low density | Operators scan 20+ rows; less fits per screen | Offer a compact row density (Linear-style) |
| 5.7 | Sidebar wastes ~60% vertical space below 8 nav items | Premium apps use it (recents, entity switcher, create) | Consider entity switcher / pinned actions in the dead zone |
| 5.8 | Insights transient run-on loading string ("Loading Xero status does not refresh tokens…") | Reads broken for a beat | Locate + separate label from guardrail caption |

**Accessibility note (good news):** token-level contrast checks pass AA for body
text (4.97:1), all chip tones (5.1–6.0:1), primary links (5.23:1), and sidebar
labels (7.35:1). `slate-300` would fail on white (2.58:1) but is correctly never
used as text there. Touch targets are 44px (`min-h-11`). This is a strength to
protect, not a fire to fight.

---

## Proposed sequencing (for your sign-off)

Ordered by impact-on-"effortless-feel" per unit of risk. Each phase is a
review-first slice with its own verification; none touches provider mutation.

- **Phase A — Make it feel instant (Gap 1).** Backend: cheap
  `/comms/queue/counts`. Frontend: stale-while-revalidate revisits + prefetch-
  on-hover + optimistic local mutations. *Biggest perceived win; directly
  answers the speed concern.*
- **Phase B — Focus the dashboard (Gap 2).** Kill the triple status
  representation, pick one hero, differentiate urgency, progressively disclose
  the rest. *Biggest "this is easy" win.*
- **Phase C — Component punch-list (Gap 5).** The eight craft fixes above —
  fast, visible, low-risk polish.
- **Phase D — Flow & keyboard (Gap 3).** j/k row nav + single-key actions on
  the daily queues.
- **Phase E — Motion/interaction-feedback pass (Gap 4).** Uniform states,
  toasts, list transitions.

Recommended start: **Phase A**, because Temba named speed as the live gap and
it has the highest feel-per-effort, with Phase B close behind.

### Build status — 2026-05-30 (A + B kickoff, uncommitted)

Temba chose to run A + B together. Shipped and statically verified this
session (eslint + tsc clean; backend ruff + full comms suite green):

- **Phase A — counts endpoint cached.** `apps/api/routers/comms.py`:
  `/comms/queue/counts` now caches per entity for 45s (module-level TTL cache),
  so the sidebar badge stops re-running the full eight-scanner queue scan on
  every navigation. Counts stay identical to a fresh scan. New test
  `test_comms_queue_counts_are_cached_per_entity` proves cache-hit (scan runs
  once across two calls) + TTL-expiry recompute. `pytest -k queue_counts` =
  2 passed; full `test_comms_api.py` = 47 passed.
- **Phase A — intent prefetch.** `app-shell.tsx`: primary nav links prefetch
  the route bundle on hover/focus (`router.prefetch`), the narrow,
  intent-based version of the prefetch the earlier perf pass had disabled
  wholesale. (Plus the badge query is `refetchOnWindowFocus:false`,
  `staleTime` 5min from the prior session.)
- **Phase B — dashboard de-duplicated (one hero).** `DashboardCommandCenter.tsx`:
  removed the right-rail summary list (Smart Intake / Billing / Onboarding /
  Operations counts) that duplicated the metric strip below. The ranked
  command center is now full-width; the review-first guardrail is a compact
  inline strip at the panel foot. Per Temba's call: the metric strip (cards +
  trend deltas + sparklines) is the single KPI home.

Verification gap to close on Temba's Mac: the Playwright smoke could not run in
the Cowork sandbox (Next middleware edge-runtime `EvalError: code generation
from strings disallowed`, and a transient :3000 conflict) — unrelated to the
diff. Run `playwright test tests/smoke/dashboard-command-center.spec.ts`
locally for the visual/flow confirmation.

Correction after code review: **urgency differentiation already exists.** The
Needs-attention and Events panels already colour each chip by due distance via
`obligationTone` (danger overdue / warning ≤14d or high priority / neutral) and
label it via `dueLabel` (Today / Tomorrow / In Nd / Nd overdue). The "wall of
Tomorrow" in the audit screenshot was genuine data clustering on 31 May, not a
flat-tone defect — so per "don't fix what isn't broken" no change was made.
The only open Phase B refinement is optional **section grouping** (Today /
This week / Later headers) for days when many items share a due window.

### Build status addendum — Phase B/C/E shipped (deployed)

- **Phase B progressive disclosure (done):** `ActivityFeedPanel` now shows the 8
  most recent audit rows with a "Show all N / Show fewer" toggle, so the feed
  no longer buries the dashboard.
- **Phase C craft (done):** Properties table hides empty Area/Parking columns;
  "Needs review" zero-state now reads "Clear" to match every other metric card.
  (Owner-tag `->` chains were left as-is — they are raw import data, not a
  code-generated separator, and the full chain already shows in the chip
  tooltip.)
- **Phase E feedback (done, first pass):** shared `Button` / `SecondaryButton`
  primitives gained consistent press (`active:` bg + 0.98 scale) and
  `focus-visible` ring states, honouring `prefers-reduced-motion`. This lifts
  every button across the app in one place.

**Phase D (keyboard flow on queues) — intentionally not shipped blind.** j/k
roving navigation + single-key actions is a real interaction feature with
focus-management, scroll-into-view, and shortcut-conflict edge cases. The
Playwright smoke can't run in the Cowork sandbox (Next middleware edge-runtime
EvalError), so shipping it without the interaction test loop would risk exactly
the kind of jank that undercuts the quality bar. Recommended to build it on the
Mac where `playwright test` runs, against the command-center list and the
operations queue. A deeper motion pass (list enter/exit transitions) similarly
wants visual verification.

## Guardrails carried through all phases

- No provider mutation (Xero / SendGrid / Twilio / tenant or owner email /
  payment reconciliation) without explicit operator approval. Optimistic UI
  applies to *local* state only.
- Surgical changes that match existing Leasium patterns; no speculative
  redesign. Verify each slice (eslint/tsc/smoke; backend pytest on the Mac).

## Sources

- [How is Linear so fast — a technical breakdown](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown)
- [The UX psychology behind Linear's speed](https://nimpatil.substack.com/p/the-ux-psychology-behind-linears)
- [Improving perceived performance of web apps](https://medium.com/swinginc/improving-perceived-performance-of-web-apps-21bf3ad1fec5)
- [Optimistic UI patterns for perceived performance](https://simonhearne.com/2021/optimistic-ui-patterns/)
- [Skeleton screens vs loading spinners](https://www.onething.design/post/skeleton-screens-vs-loading-spinners)
- [Instant pages with the Speculation Rules API](https://dev.to/aomuiz/instant-pages-with-speculation-rules-the-secret-to-lightning-fast-web-navigation-1b37)
- [SaaS dashboard design best practices 2025](https://www.context.dev/blog/dashboard-design-best-practices)
- [B2B SaaS dashboard optimization guide 2025](https://www.orbix.studio/blogs/saas-dashboard-design-b2b-optimization-guide)
- [Minimalist UI design for SaaS](https://uitop.design/blog/design/minimalist-ui-design/)
