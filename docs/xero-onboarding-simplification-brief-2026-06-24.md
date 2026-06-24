# Xero Onboarding Simplification — Design Brief (2026-06-24)

## Problem

The Settings → Xero surface is hard to set up, for the operator and (more
importantly) for future customers. The root cause is **three different audiences
sharing one screen**:

1. **Developer / deployment setup** — `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`,
   `XERO_TOKEN_ENCRYPTION_KEY`, redirect URI, required scopes. Done **once per
   deployment by us**, never by a customer — yet shown to everyone.
2. **Operator connection** — the single "Connect with Xero" OAuth click.
3. **Support diagnostics** — diagnostics packets, freshness snapshot, exception
   queue, provider preflight.

Everything is presented flat and at once, so a one-click action reads like a
provisioning task. Separately, we already pull the Xero chart (the existing
**Chart/tax validation** step), but we only use it to *validate* charge rules —
not to *autofill* mappings. That's the missing half of the "download the chart
and autofill" idea.

## Goal

Default Xero view collapses to a **clean connected state with at most a few
things to confirm**. Setup friction → near zero; the review-first mutation gate
(§2.1) is untouched. Setup friction and mutation approval are different things —
only the second stays explicit.

## The autofill flow (connect → auto-map → confirm)

This is the canonical pattern Xero recommends (map the chart right after OAuth)
and what Re-Leased does in practice (auto-sync accounts/tax/tracking on connect).

1. **Connect** — one "Connect with Xero" button → OAuth → returns the authorised
   org. (No env-var checklist in front of the operator.)
2. **Auto-map** — immediately pull `Accounts`, `TaxRates`, `TrackingCategories`.
   Auto-assign:
   - a **default income account** for rent/charge rules (match by code, then by
     name similarity, e.g. "Rent" → "Rental Income"),
   - a **default GST tax type** from the org's *existing* rates.
3. **Confirm** — one screen: "We mapped these — confirm or change." Pre-filled,
   user only touches the few that need a human decision. This is a **mapping
   confirmation, not a provider write**, so it stays review-first by definition.

Get the user to "can draft an invoice" with one default income account + one GST
type. Defer tracking categories and payment-reconciliation config behind
**Advanced**. Don't block on mapping all account types.

## Settings IA — split the three audiences

| Today (flat) | Proposed |
|---|---|
| Env-var / client-id / secret checklists | **Removed from operator view.** Deployment concern; lives in `docs/deployment.md` + a platform-admin-only check. |
| Redirect URI / required scopes preflight | Platform-admin / Advanced only. |
| "Connect with Xero" + connected state | **Default view.** Connected ✓, selected entity, "N things to confirm." |
| Chart/tax validation | Folded into the **auto-map → confirm** step. |
| Diagnostics packet, freshness snapshot, exception queue | Behind an **Advanced / diagnostics** disclosure. |

Default state target: `Connected ✓ — SJI No 1 Pty Ltd · 3 items to confirm`,
everything else one click away.

## AU / Xero specifics (bake in)

- **Never create tax rates via the API.** API-created rates don't work for GST
  filing in AU/NZ/UK. Read and reuse the org's existing GST rates (GST on
  Income, GST Free, etc.) and map to those.
- Don't trust Xero's default account codes — customers customise them. Always map
  against the *pulled* chart, which we already do.

## Scope / non-goals

- **In scope:** auto-map step at connect, settings IA split, hiding deployment
  setup from operators.
- **Out of scope:** two-way sync from Xero → Leasium, auto-posting (guardrail
  stays — explicit approval before any draft creation/dispatch), payment-rail
  work (parked).
- Gate on **account operating mode** consistent with the rest of Settings
  (`self_managed_owner` is the SKJ default).

## Next step (UX gate, §2.2)

Design-facing → Figma-first. Add a frame for the **connect → auto-map → confirm**
flow and the re-grouped Settings → Xero default/Advanced split to the Design
Source of Truth (`03 Screens`), get Temba's sign-off there, then build to spec
with a same-session UX pass. No code before the frame is signed off.

## Open questions

1. Auto-map confidence: auto-apply a default income account silently, or always
   show it in the confirm step? (Lean: always show, pre-selected.)
2. Is the env-var preflight ever operator-facing, or strictly platform-admin?
   (Lean: platform-admin only.)
3. Multi-entity: confirm the auto-map runs per entity (Xero is per-entity today).
