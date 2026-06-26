# Track C — Switcher → portfolio filter: UX design brief (2026-06-25)

**Status: DESIGN-GATED (§2.2).** This brief drives the Figma stage — it is *not*
code yet. Build only after Temba signs off the frames in Figma (that sign-off is
the human gate). Companion: `docs/multi-entity-dimension-plan-2026-06-25.md`
(this is Track C of that plan).

## Goal

Turn the sidebar entity switcher from "an active context you're locked into" into
an **optional portfolio filter**. Default = **All entities** (unified portfolio).
A single entity becomes a *pin you can set and clear*, never a required selection.
Plus: make the owning entity **explicit and editable at every write/data-entry
point** — the fix for the recurring wrong-trust import.

## Why (recap)

Unified-with-filter is the market norm (Re-Leased, Stessa) and matches the
original `multi-entity-xero-ia.md` intent ("the cross-entity rollup is the
payoff"). The backend is already org-wide-by-default; the remaining pain is that
the UI still *presents* a hard switcher. See the plan doc.

## Surfaces

- **Sidebar entity switcher** — `Leasium/Horizon/Sidebar 44:117` →
  `apps/web/src/components/app-shell.tsx`. Shared by ALL desktop screens
  (Dashboard 45:2, Work 45:168, Properties 55:2, Settings 55:439, People 61:580,
  Money 61:842, Insights 61:1063) and the mobile shell (Dashboard·Mobile 45:371,
  Work·Mobile 45:461). This is the control in Temba's screenshot.
- **Create/apply forms that bind an entity** — New property (pick-or-create entity
  already exists), New tenant / arrears / work-order / compliance, and **Smart
  Intake apply** (the trust-selection surface — see
  `smart-intake-trust-selection-2026-06-25.md`).

## Spec — the filter

1. **Default = All entities** (portfolio). The control reads as a filter, e.g.
   "Viewing: All entities ▾", not a mode you're trapped in.
2. **Pin / clear.** Selecting an entity filters the portfolio to it (an optional
   persistent pin) with an always-visible "All entities" / clear affordance.
   Clearing returns to unified. Never strand the user in one entity with no
   obvious way back.
3. **Persistence.** Keep the `leasium.entity_id` pin in localStorage; multi-entity
   orgs default to All (`defaultEntitySelection` already does this). Single-entity
   orgs need no filter chrome (one entity *is* the portfolio).
4. **Read-only scoping.** The filter scopes *reads*. It does NOT gate writes.
5. **Entity-tag rows in the All view.** Every list row shows its owning entity as
   a low-emphasis chip (responses already carry `entity_id`), so the unified view
   stays legible. Reuse the 02 Components status-chip pattern — no new tokens.

## Spec — inline entity attribution (the wrong-trust fix)

Every create/apply that binds an entity shows the target inline and editable *at
the point of action*:

- **New-record forms:** "Adding to *[Entity ▾]*" beside the primary action;
  defaults sensibly (active pin, or pick-or-create) but is always changeable
  before submit.
- **Smart Intake apply:** show the resolved target entity per row with confidence
  and a change control *before* Apply (ties to the slice-1 `target_entity_id`
  work). Never silently inherit the switcher's pin.
- **Posting/Xero preview** keeps "Posts to *[Entity]*'s Xero" (already shipped) —
  same principle at the money layer.

## What STAYS entity-scoped (correct, not a regression)

Xero connect, tax settings, entity statements, posting/reconciliation previews,
and any per-entity legal/accounting surface remain explicitly one-entity — single
context is the right mental model there. Keep them scoped; just don't make the
*whole app* behave that way.

## Figma stage (do this first — §2.2 / §2.12)

File `PO2jOANgmqgZHfqWZXOZGU`:

1. Duplicate `Leasium/Horizon/Sidebar 44:117` → a "portfolio filter" variant
   showing (a) the default All-entities state and (b) a pinned-single-entity state
   with a visible clear. Reuse Segmented control 44:282 / status-chip patterns.
2. Update the highest-signal 03 Screens to show the All-entities default + an
   entity-tag chip on list rows: Work 45:168, Properties 55:2, People 61:580; and
   mobile Dashboard·Mobile 45:371, Work·Mobile 45:461.
3. Add an inline "Adding to *[Entity ▾]*" treatment to one create form + the Smart
   Intake apply frame (reuse Select 56:157, Drawer 56:173, Modal 56:163).
4. **Get Temba's sign-off in Figma. No code before it.**

## Build → UX pass → log

After sign-off: pull context via the Figma MCP (`get_design_context` /
`get_screenshot`), build to spec, then run the UX gate — checklist + real
screenshots at 1440px and 390px + the hallmark slop test; fix findings in-slice;
add a UX Pass Log line in `docs/design-governance.md` (surface, screens checked,
fixes, anything deferred).

## Guardrails + verification

- **§2.1:** filter is read-only; entity stays mandatory at write; no provider
  behaviour changes.
- **Verify:** `eslint src`; `tsc --noEmit`; Playwright smoke
  (`NODE_ENV=development …`). Add/extend a smoke fixture with ≥2 entities
  asserting: All-entities default shows multi-entity rows with entity chips; pin
  filters; clear restores unified; create-form attribution shows and can change
  the target.

## Sequencing

Depends on **Codex Track A** (org-wide reads for comms + the notification center)
and **Track B** (wire those two pages off `useEntityFanOut`) landing first, so the
All-entities view is fast everywhere *before* the switcher is demoted to a filter.
