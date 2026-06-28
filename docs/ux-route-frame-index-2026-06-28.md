# Relby UX Route Frame Index - 2026-06-28

This is the repo-side R0 source map for the Relby full-platform UX cleanup.
It mirrors the Figma frame `03 Screens / Route Frame Index - 2026-06-28`
(`186:988`) and gives coding agents a plain-text route contract before design
or implementation work starts.

Rule: every design-facing cleanup slice must name its Figma source frame before
code. Routes marked partial, stale, or missing need a Figma refresh or Temba
sign-off before code changes.

## Evidence Sources

- Roadmap: `docs/ux-platform-audit-roadmap-2026-06-28.md`
- UX governance: `docs/design-governance.md`
- Figma file: `Leasium - Design Source of Truth`
  (`PO2jOANgmqgZHfqWZXOZGU`)
- Figma route index: `03 Screens / Route Frame Index - 2026-06-28`
  (`186:988`)
- Desktop evidence:
  `output/ux/live-platform-audit-2026-06-28/desktop-contact-sheet.png`
- Repeatable audit harness: `apps/web/scripts/live-ux-audit.mjs`

## R0 Command Block

Refresh the signed-in session:

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart/apps/web
LEASIUM_AUDIT_URL=https://www.relby.ai npm run audit:live -- --login
```

Run the platform audit:

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart/apps/web
LEASIUM_AUDIT_URL=https://www.relby.ai \
LEASIUM_AUDIT_ROUTE_PRESET=platform \
LEASIUM_AUDIT_OUTPUT_DIR=../../output/playwright/live-audit-r0-platform \
npm run audit:live
```

Run the harness unit check:

```bash
cd /Users/tembavanjaarsveld/Documents/Stewart/apps/web
npm run audit:live:test
```

## Current Blockers

| ID | Blocker | Queue Position | Unblock Signal |
| --- | --- | --- | --- |
| UX-BLOCKED-001 | Saved production audit session is expired for desktop and mobile. | Back of queue until operator login is available. | Temba refreshes the browser login via `npm run audit:live -- --login`. |
| UX-BLOCKED-002 | `/portfolio-qa` has no committed Horizon frame. | R3. | Temba approves Portfolio QA desktop/mobile Figma frames. |
| UX-BLOCKED-003 | Settings two-pane and Message Templates shipped UI are ahead of Figma. | R4. | Settings frame `55:439` and Message Templates subsection are refreshed in Figma. |
| UX-BLOCKED-004 | `/people?tab=owners` fallback needs intentional self-managed copy/state. | R1. | Temba chooses hide/redirect/explainer behaviour. |
| UX-BLOCKED-005 | `/tasks` legacy redirect needs command/search decision. | R1. | Keep as documented alias or remove from command/search surfaces. |

## Route Map

| Production route or state | Route type | Current Figma source | Implementation area | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `/` | Primary route | Dashboard `45:2`; mobile `45:371`; dark reference `62:696` | `apps/web/src/app/page.tsx`, `apps/web/src/components/dashboard.tsx` | Approved source | Decide whether `View demo portfolio` belongs in live operator accounts. |
| App shell | Shared shell | Sidebar `44:117`; command bar `44:155`; bottom nav `44:301` | `apps/web/src/components/app-shell.tsx` | Approved source | Keep seven-item sidebar cap and mobile bottom-nav pattern. |
| `/intake` | Primary route | Smart Intake `55:166`; mobile `59:521` | `apps/web/src/app/intake/page.tsx`, `apps/web/src/components/dashboard.tsx` | Approved but ambiguous | Relby AI home also has later concept references. Verify the source frame before major redesign. |
| `/intake?review=...` | Record/review state | Document review `58:352` | `apps/web/src/components/dashboard.tsx` | Approved source | Review-first apply boundary remains mandatory. |
| `/inbox` | Hidden operator route | AI Mailbox Intake `82:2` | `apps/web/src/app/inbox/page.tsx` | Partial source | Verify node access before UI work; not visible in current 03 Screens top-level dump. |
| `/properties` | Primary route | Properties `55:2`; mobile `59:427` | `apps/web/src/app/properties/page.tsx`, `apps/web/src/components/property-workspace.tsx` | Approved source | Covers card/table/map portfolio modes. |
| `/properties?view=table` | Query state | Properties `55:2` | `apps/web/src/components/property-workspace.tsx` | Approved source | URL state exists. |
| `/properties?view=map` | Query state | Properties `55:2` | `apps/web/src/components/property-workspace.tsx` | Approved source | URL state exists. |
| `/properties?property_id=...` | Record state | Property detail `58:627` | `apps/web/src/components/property-workspace.tsx` | Needs R5 clarification | Current route still reads like portfolio workspace plus selected record. |
| `/people?tab=tenants` | Tab state | People `61:580` | `apps/web/src/app/people/page.tsx` | Approved source | Touch targets need R2 mobile/desktop tightening. |
| `/people?tab=owners` | Gated tab state | People `61:580` | `apps/web/src/app/people/page.tsx` | Needs R1 decision | Self-managed mode falls back to tenants; needs intentional copy/state. |
| `/people?tab=vendors` | Tab state | People `61:580` | `apps/web/src/app/people/page.tsx` | Approved source |  |
| `/people?tab=prospects` | Tab state | People `61:580` | `apps/web/src/app/people/page.tsx` | Needs route contract | Prospects availability should be explicit. |
| `/people/tenants` | Redirect | People `61:580` | `apps/web/src/app/people/tenants/page.tsx` | Documented alias | Redirects to `/people?tab=tenants`. |
| `/people/vendors` | Redirect | People `61:580` | `apps/web/src/app/people/vendors/page.tsx` | Documented alias | Redirects to `/people?tab=vendors`. |
| `/operations` | Primary route | Work `45:168`; mobile `45:461` | `apps/web/src/app/operations/page.tsx` | Approved source | URL-backed tabs are the strong pattern. |
| `/operations?tab=approvals` | Tab state | Work `45:168`; mobile `45:461` | `apps/web/src/app/operations/page.tsx` | Approved source | Approvals inbox stays read-only. |
| `/operations?tab=workflows` | Tab state | Workflows `170:850`, `170:1168`, `170:1486`; mobile `170:1056`, `170:1374`, `170:1692` | `apps/web/src/app/operations/page.tsx` | Approved source | Review-first workflow proposals. |
| `/operations?tab=calendar` | Tab state | Work `45:168`; mobile `45:461` | `apps/web/src/app/operations/page.tsx` | Approved source |  |
| `/operations?tab=maintenance` | Tab state | Work `45:168`; mobile `45:461`; detail density `123:812`, `124:850` | `apps/web/src/app/operations/page.tsx`, `apps/web/src/app/operations/maintenance/[workOrderId]/page.tsx` | Approved source | Provider guardrails remain. |
| `/operations?tab=compliance` | Tab state | Work `45:168`; mobile `45:461` | `apps/web/src/app/operations/page.tsx` | Approved source | Next work should move toward evidence/completion actions. |
| `/operations?tab=arrears` | Tab state | Work `45:168`; mobile `45:461` | `apps/web/src/app/operations/page.tsx` | Approved source |  |
| `/work/comms` | Hidden operator route | Comms template density `116:812`; mobile `116:933` | `apps/web/src/app/work/comms/page.tsx` | Partial source | Needs route contract and full frame if elevated. |
| `/comms` | Hidden operator route | Comms template density `116:812`; mobile `116:933` | `apps/web/src/app/comms/page.tsx` | Partial source | No full Comms queue frame found. |
| `/notifications` | Primary route | Notifications `55:307`; mobile `59:594` | `apps/web/src/app/notifications/page.tsx` | Approved source |  |
| `/tasks` | Legacy redirect | Work `45:168` | `apps/web/src/app/tasks/page.tsx` | Needs R1 decision | Keep as documented alias or remove from command/search surfaces. |
| `/money` | Primary route | Money `61:842` | `apps/web/src/app/money/page.tsx` | Approved source |  |
| `/billing-readiness` | Module route | Money `61:842` | `apps/web/src/app/billing-readiness/page.tsx` | Partial source | Dedicated billing readiness tabs are shipped and URL-backed. |
| `/billing-readiness?tab=readiness` | Tab state | Money `61:842` | `apps/web/src/app/billing-readiness/page.tsx` | Partial source | Strong route pattern. |
| `/billing-readiness?tab=billing-drafts` | Tab state | Money `61:842` | `apps/web/src/app/billing-readiness/page.tsx` | Partial source | Strong route pattern. |
| `/billing-readiness?tab=delivery` | Tab state | Money `61:842` | `apps/web/src/app/billing-readiness/page.tsx` | Partial source | Strong route pattern. |
| `/statements` | Hidden/module route | Money `61:842` | `apps/web/src/app/statements/page.tsx` | Partial source | Needs route contract if expanded. |
| `/money/statements` | Redirect | Money `61:842` | `apps/web/src/app/money/statements/page.tsx` | Documented alias | Redirects to statements route. |
| `/money/billing` | Redirect | Money `61:842` | `apps/web/src/app/money/billing/page.tsx` | Documented alias | Redirects to Billing Readiness. |
| `/money/xero` | Redirect | Settings `55:439` | `apps/web/src/app/money/xero/page.tsx` | Documented alias | Redirects to Xero/settings. |
| `/money/basiq` | Redirect | Settings `55:439` | `apps/web/src/app/money/basiq/page.tsx` | Documented alias | Redirects to settings. |
| `/insights` | Primary route | Insights `61:1063` | `apps/web/src/app/insights/page.tsx` | Approved source | Production `Field required` error is P0 triage. |
| `/settings` | Primary route | Settings `55:439`; mobile `59:677` | `apps/web/src/app/settings/page.tsx` | Stale source | Shipped two-pane workspace needs Figma refresh. |
| `/settings?tab=security` | Tab state | Settings `55:439` | `apps/web/src/app/settings/page.tsx` | Stale source |  |
| `/settings?tab=notifications` | Tab state | Settings `55:439` | `apps/web/src/app/settings/page.tsx` | Stale source |  |
| `/settings?tab=activity` | Tab state | Settings `55:439` | `apps/web/src/app/settings/page.tsx` | Stale source |  |
| `/settings?tab=connect` | Tab state | Settings `55:439` | `apps/web/src/app/settings/page.tsx` | Stale source |  |
| Settings Organisation subtabs | Client state | Settings `55:439` | `apps/web/src/app/settings/page.tsx` | Needs R4 refresh | Overview, payments, comms, and entities need committed Figma state. |
| Settings Message Templates subtabs | Client state | Comms template density `116:812`; mobile `116:933` | `apps/web/src/app/settings/page.tsx` | Needs R4 refresh | Messages, branding, delivery receipts, and advanced need committed Figma state. |
| `/portfolio-qa` | Hidden operator route | No committed Horizon frame | `apps/web/src/app/portfolio-qa/page.tsx` | Missing source | R3 flagship redesign as trust workbench. |
| Portfolio QA tabs | Client state | No committed Horizon frame | `apps/web/src/app/portfolio-qa/page.tsx` | Missing source | Data QA, Contacts, Source History, Onboarding Prep, Billing Drafts. |
| `/contractors` | Legacy/hidden route | People `61:580` or Vendor pattern | `apps/web/src/app/contractors/page.tsx` | Needs route contract | Decide whether it stays as legacy directory or moves fully under People. |
| `/admin` | Platform route | Platform admin mailbox aliases `109:812`; mobile `109:908` | `apps/web/src/app/admin/page.tsx` | Approved source | Platform-only surface. |
| Tenant portal mobile | Portal route | Tenant portal mobile `61:1251` | `apps/web/src/app/tenant-portal/*` | Approved mobile source | Desktop portal route contract is separate. |
