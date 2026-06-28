# Relby Navigation And Deep-Link Contract - 2026-06-28

This is the R1 contract for the full-platform UX cleanup. It follows
`docs/ux-platform-audit-roadmap-2026-06-28.md` and
`docs/ux-route-frame-index-2026-06-28.md`.

Rule: navigation changes stay Figma-first. Code changes to tabs, redirects,
command search, sidebar, or mobile navigation must name the approved source
frame and update this contract when the route behaviour changes.

Figma mirror: `04 Governance / Navigation Deep-Link Contract - 2026-06-28`
(`187:997`).

## Current Navigation Shape

Relby keeps a compact operator shell:

- Desktop primary hubs: Dashboard `/`, Relby AI `/intake`, Properties
  `/properties`, People `/people`, Work `/operations`, Money `/money`,
  Insights `/insights`, Settings `/settings`.
- Mobile primary destinations: Home, Properties, Smart Intake capture, Work,
  Money. Other hubs stay reachable through the menu/search pattern.
- Command search carries folded destinations such as AI Inbox, Comms, Owner
  statements, Billing Readiness, and Portfolio QA.
- Platform admin is an admin-tier route only and does not count against the
  client operator hub cap.

## URL Contract

| Surface | Current URL state | Contract |
| --- | --- | --- |
| Work | `?tab=approvals|workflows|calendar|maintenance|compliance|arrears`, plus filters for approvals, maintenance, arrears, assignee, trust tag | Keep as the model for durable module tabs and shareable working filters. Default queue may omit `tab`. |
| Billing Readiness | `?tab=readiness|billing-drafts|delivery`, `?filter=...`, `?invoice_id=...` | Keep. It is the clearest Money sub-workflow contract. |
| People | `?tab=tenants|owners|vendors|prospects`, `?trust_tag=...` | Keep tab URLs. Add an intentional self-managed Owners state before changing code. |
| Properties | `?view=table|map`, `?property_id=...`, `?entity_id=...`, `?occupancy=...`, `?owner_tag=...` | Keep portfolio modes. Property record subtabs need a Figma decision before code adds URL state. |
| Settings | `?tab=security|notifications|activity|connect|xero` with Organisation as default | Keep top-level settings tabs. Nested Organisation and Message Templates sections need URL state after the Figma refresh. |
| Portfolio QA | Client-only tab state today | R3 redesign should add durable tabs before implementation: `?tab=issues|contacts|sources|onboarding|billing-drafts`. |
| Comms / Notifications | `?trust_tag=...` | Keep. Trust tag is the standard list-scoping filter in all-entities mode. |
| Smart Intake | `?review=...`, `?ask=...`, `?thread_id=...`, `?entity_id=...`, `context_record_refs=...` | Keep review-first. Review IDs and context refs are record handles, not navigation tabs. |

## Redirect And Alias Contract

| Alias | Current target | Contract |
| --- | --- | --- |
| `/tasks` | `/operations` | Keep as a legacy alias, but command/search should prefer Work wording. If touched, redirect to `/operations?tab=queue` only if queue becomes an explicit URL tab. |
| `/work` | `/operations` | Keep as compatibility alias. |
| `/work/comms` | `/comms` | Keep until Comms is fully folded into Work or Settings. |
| `/people/tenants` | `/people?tab=tenants` | Keep. |
| `/people/vendors` | `/people?tab=vendors` | Keep. |
| `/money/statements` | `/statements` | Keep. |
| `/money/billing` | `/billing-readiness` | Keep. |
| `/money/xero`, `/money/basiq` | `/settings?tab=xero` | Keep until Settings/Connect is refreshed in Figma. |
| `/reports` | `/insights` | Keep as legacy alias. |

## Decisions

- Durable module state uses `tab`. Default tabs should be omitted where that
  keeps URLs clean.
- List scoping in all-entities mode uses `trust_tag`.
- Record handles use explicit names: `property_id`, route params such as
  `/tenants/[tenantId]`, `review`, `invoice_id`, and workflow-specific ids.
- `action` may open create/edit UI, but should not become a durable workflow
  state without a design decision.
- Command search should label folded destinations by the current IA, not by
  stale route names.
- Legacy aliases are allowed for muscle memory and inbound links, but should
  not justify extra sidebar items.

## R1 Open Decisions

| ID | Decision | Recommended next step |
| --- | --- | --- |
| R1-001 | Self-managed `/people?tab=owners` currently falls back to Tenants. | Design a gated Owners explainer or a Settings handoff state in Figma, then implement it so the deep link feels intentional. |
| R1-002 | Portfolio QA tabs are client-only. | Make URL-backed tabs part of the R3 Portfolio QA Figma redesign. |
| R1-003 | Settings Organisation and Message Templates subtabs are client-only. | Decide URL state during the R4 Settings Figma refresh. |
| R1-004 | Property record subtabs are client-only and mixed with portfolio `view`. | Decide a record grammar in R5 before adding `property_tab` or another record-state parameter. |
| R1-005 | `/contractors` is a legacy directory beside People Vendors. | Keep read-only for now; move command/search to People Vendors when vendor parity is confirmed. |
| R1-006 | `/tasks` is a Work alias with stale language. | Keep redirect for compatibility; avoid surfacing `Tasks` as a first-class command unless Work queue naming changes. |

## Acceptance Checks For Future Code

- A copied URL restores the same module tab and primary filter state.
- Mobile navigation and command search do not expose a different IA from
  desktop; they expose a smaller entry set into the same structure.
- Gated deep links explain why they are gated instead of silently moving the
  operator elsewhere.
- Provider-adjacent routes remain review-first. No navigation shortcut may
  bypass approval for Xero, SendGrid, Twilio, tenant email, payments, or
  reconciliation.
- Every route or state added here is mirrored in the audit harness platform
  preset or explicitly marked as client-only/unscannable.
