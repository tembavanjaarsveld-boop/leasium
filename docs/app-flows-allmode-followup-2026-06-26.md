# app-flows all-mode integration greening — follow-up (2026-06-26)

## Status — resolved on `main`

This follow-up is closed. The original gap list below is preserved as historical
context; do not treat it as active work. The closing commits are `8cde5ca`,
`510f5c7`, and `ded8f9b`, with the final verification recorded in
[RESOLVED — 2026-06-26](#resolved--2026-06-26).

No remaining all-mode integration work is tracked in this file.

## Original brief (historical)

Scope carved out of the switcher rip-out (decision: lock in the verified
bug/gap fixes; treat the deep app-flows *integration* greening as this
tracked follow-up).

### Where things stood

Committed + green this session (local `main`, not pushed):

- `9eaffa2` comms templates org-wide + trust pickers
- `fb4a114` comms CSV export date in all-mode
- `79f783b` Properties calendar/map/metrics org-wide (`properties-*` 34/34)
- `4e7e372` all-mode bug fixes: inbox classify button, notifications mobile
  summary, comms queue "generated" date
- `5f15a7d` nav smoke assertions reworked for the removed switcher
  (`mobile-bottom-nav`, `nav-consolidation`)

Dedicated per-surface smokes are green: `comms*`, `inbox*`, `settings*`,
`statements*`, `properties-*`, `operations-*`, `portfolio-qa*`, `contractors`,
`tenants-ux`, `mobile-bottom-nav`, `nav-consolidation`.

The genuine all-mode **bug** found and fixed: the AI-inbox classify button gated
on `!scopedEntityId` (always empty in all-mode) → permanently disabled. Now
`!actionEntityId`.

### Original follow-up scope

The big integration spec `app-flows.spec.ts` plus `notifications.spec.ts` still
have **layered** all-mode assertions — each test has several entity-sensitive
checks, so fixing one reveals the next. Two categories:

#### Source gaps (need code, not test edits)

- **Notification center per-entity actions.** Notice Send/Retry/SMS + digest
  send are gated on `allMode` (disabled). Correct fix = **row-trust**: each
  notice's action fires under `notice.entity_id` (the record is entity-tagged in
  all-mode), exactly like Operations slice 9. **§2.1 caution:** this enables
  provider sends from the all-entities view — still explicit-click = operator
  approval, but get Temba's OK before shipping (he flagged it).
  Files: `apps/web/src/app/notifications/page.tsx` (`sendNoticeMutation`,
  `sendSmsNoticeMutation`, digest mutation, the `disabled={... || allMode}`
  buttons ~1493/1507/1664). Tests: `app-flows:3241`, `notifications.spec`
  156/170/274.
- **Channel readiness in all-mode.** The org-wide notification center returns
  `channels: []` by design (`OrgWideWorkAssignmentNotificationCenterRecord`),
  so "Email actionable / SMS actionable / Provider setup checks" never render in
  all-mode. Channel/provider readiness is largely org-level (SendGrid/Twilio env)
  — decide: surface it org-wide (backend change to populate channels on the
  org-wide center) vs per-trust via the trust-tag filter. Tests: `app-flows:3241`,
  `notifications.spec` 11/76/170/274.
- **Billing "Open recovery".** Per-entity recovery affordance hidden in all-mode
  (`app-flows:855` now reaches it after the waypoint fix).
- **Settings "Accounting missing".** Xero status label in all-mode
  (`app-flows:6599`, after the shell-switcher assertions were removed).
- **Smart intake** (`app-flows:5099/5122/5183`) and **tenant detail**
  (`app-flows:4903/5061`) all-mode integration paths — triage each.
- **Comms queue counts** (`app-flows:1716/2238`) — confirm merged all-mode
  counts vs the single-entity expectations.

#### Test drift (the all-mode behaviour is correct; the assertion is stale)

- `app-flows:4357` properties merge — `$8,000/mo` `toHaveCount(0)` assumed rent
  is hidden; in all-mode cards show rent. Update to expect it.
- `notifications.spec:11` desktop description regex `/Work notices and digest
  receipts/` doesn't match the all-mode "N work notices and M digest receipts
  across every entity" copy.

### Uncommitted WIP to finish or revert

`apps/web/tests/smoke/app-flows.spec.ts` has **partial** edits from this session
(waypoint/switcher/URL fixes for tests 855, 4355, 4421, 6604/6599) — they
advance each test past the fixed assertion but the tests are not green (they hit
the next all-mode assertion). Either complete them alongside the source gaps
above, or `git checkout` the file and redo holistically. `notifications/page.tsx`
mobileDescription is already committed in `4e7e372`.

### Method note

Verify per-spec in isolation (`playwright test <spec> -g "<title>"`), not via the
full 417-test run — the full run is slow and flaky under port contention, which
muddies regression-vs-flake signal.

## RESOLVED — 2026-06-26

Superseded. Every source gap and test-drift item above shipped and is green on
`main`; this doc predated the three commits that closed it:

- `8cde5ca` Finalise all-mode surface adaptations — Settings, Smart Intake,
  Statements, People, Contractors, Money (in-page picker / row trust per surface).
- `510f5c7` Close notification-center + billing-recovery all-mode gaps — per-notice
  Send/Retry/SMS + digest send via **row trust** (notice/receipt `entity_id`),
  dropping the `allMode` disable; org-level channel readiness in all-mode; billing
  recovery (old 855); notifications description regex (old `notifications.spec:11`).
  This is the §2.1 item flagged above — it shipped review-first (explicit per-row
  click = operator approval, under that row's own trust), so **no sign-off is
  pending**.
- `ded8f9b` Row-trust comms + billing per-row dispatch — comms approve&send /
  dismiss / attach-evidence and per-row billing/invoice actions resolve the entity
  from the row server-side; the `|| allMode` gate is removed. (Covers old comms
  1716/2238 and the 4357 properties-merge rent drift.)

### Verification (current `main`, `NODE_ENV=development`)

Line numbers had shifted; each cited test was mapped by title and run in isolation:

- Smart intake + tenant detail (5105/5128/5189, 4909/5067): **19 passed**.
- All-entities reads + notification center + comms + settings Xero
  (3243, 1714, 2236, 4358, 4423, 4460–4675, 4704, 4773, 6605): **17 passed**.
- Full `notifications.spec.ts` (11/77/142/157/171/275): **6 passed**.

42/42 green across every item this doc listed. `eslint src` + `tsc --noEmit` clean
on the same `main`. No remaining all-mode integration work.
