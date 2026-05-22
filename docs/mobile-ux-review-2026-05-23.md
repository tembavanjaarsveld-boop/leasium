# Leasium Mobile UX Review — 2026-05-23

**Reviewer brief:** focused mobile pass over the main operator and tenant surfaces. Target viewport 360-480px (modern phones in portrait), with secondary attention to 480-768px (large phones / small tablets). The goal is "thumb-readable in 5 seconds, tap-accurate on first try" — not visual polish.

**Method:** read the responsive Tailwind/markup in the codebase (`apps/web/src/components/app-header.tsx`, `dashboard.tsx`, `property-workspace.tsx`, `apps/web/src/app/tenants/page.tsx`, `tenants/[tenantId]/page.tsx`, `operations/page.tsx`, `notifications/page.tsx`, `settings/page.tsx`, `billing-readiness/page.tsx`, `tenant-portal/tenant-portal-content.tsx`, `inbox/page.tsx`). This is a code-driven audit, not a live phone walkthrough. Anything below marked **needs phone validation** is plausible from the markup but not directly verified.

**Context:** the Tier 3 v1 mobile audit (commits `78f4e5e`, `83d3c8a`) has already addressed three of the worst issues — header utility row wrap, Dashboard metric grid breakpoints, Properties workspace table horizontal scroll. This review reads the current state, not the pre-audit state, so it is incremental.

---

## 1. What's already working

The shell foundation is genuinely solid and should not be touched:

- **Mobile sidebar drawer.** `AppHeader` hides the 240px sidebar below `lg` and opens a full-height left drawer via the hamburger. Animation, z-stacking, and dismiss are correct.
- **Full-width inputs and selects.** UI primitives default to `w-full`, eliminating the most common horizontal-overflow trap in forms.
- **`flex-wrap` on action clusters.** Button rows wrap rather than overflow on narrow widths — visible on the Tenants page, Operations work-order detail, and Settings forms.
- **Primary buttons meet 44px.** `Button` and `SecondaryButton` use `min-h-11` (44px), matching Apple HIG.
- **Form grids collapse correctly.** `md:grid-cols-2` → single column below 768px is consistent across the property add-form, tenant edit-form, and the new tenant portal onboarding panel.

These do not need re-litigation.

## 2. What's verified from code as rough at 360px

### 2a. Tenants list — highest user impact

`apps/web/src/app/tenants/page.tsx` renders a five-column table (Tenant / Onboarding / Due / Contact / Next action). At 360px the table relies on horizontal scroll, and within each row:

- The **Onboarding column** stacks up to three `StatusBadge` elements vertically (delivery status, reminder status, contact-fix banner). On a phone this is the densest piece of information per row.
- The **Contact column** has inline-edit cells (name, email, phone). On a phone the pencil affordance and the click-to-edit / Enter-to-commit pattern is borderline hostile — no hover state, tiny target, easy to mis-tap.
- The **Next action column** uses `flex-wrap` for up to 2-3 buttons. Wraps, but doubles row height.

The table fits but does not read. Tenants is also one of the most-used surfaces, so this is the highest-leverage mobile fix in the app.

**Recommendation:** below `md`, swap the table for a stacked-card layout per tenant — Name + single Status pill + a single "Open" affordance that navigates to the existing tenant detail page. Hide Onboarding/Contact/Next-action details on phone — they are still available one tap deeper. Keep the existing desktop table unchanged.

### 2b. Header icon-only buttons — small fix, instant payoff

`apps/web/src/components/app-header.tsx` and the related shell render search, notifications, account, and (on >=sm) keyboard-cheatsheet icons as `h-10 w-10` (40×40px). Below Apple's 44px HIG; below Material's 48px. Hamburger and search are the two a phone user hits constantly.

**Recommendation:** `h-11 w-11` with 4px of margin around each, or wrap in an 11×11 hit-area `span` if the icon visual itself must stay at 40px.

### 2c. Tenant detail onboarding row — visual heavy

`apps/web/src/app/tenants/[tenantId]/page.tsx` renders, per live onboarding: a 4-column status sub-grid (Delivery / Reminders / Expires / Applied), a reminder schedule sub-card with 1-3 reminder mini-cards, a delivery timeline, a receipts strip, and the action button cluster (now including the new "Invite to portal"). At desktop widths the rich detail is appropriate; on a phone each onboarding card lands at 400+px tall and the action buttons sit below the fold.

**Recommendation:** below `md`, collapse Delivery / Reminders / Expires / Applied into a single "Provider detail ▾" disclosure that defaults to closed. Keep the row status badge, due date, and action cluster visible.

### 2d. Settings tab strip — needs verification but likely missing horizontal scroll

`apps/web/src/app/settings/page.tsx` uses tabs (Organisation, Notifications, Security, Integrations, plus the new Ownership tags panel). Need to verify the tab strip has `overflow-x-auto` and a snap target — if not, the rightmost tabs are unreachable on narrow phones.

**Recommendation:** confirm tab strip wrapper has `flex flex-nowrap overflow-x-auto` with at least `pb-1` to expose any scrollbar, and tabs use `whitespace-nowrap`.

## 3. Needs phone validation

The following surfaces have plausible responsive markup but I cannot honestly evaluate without a real device:

- **Notifications.** The densest read-only surface in the app — work notice cards, digest receipts, channel readiness strips, provider history. The responsive classes are there but density at 360px is the question, not whether content fits.
- **Operations / work-order detail.** Multi-tab list, status chips, priority indicators, assignment metadata, activity timeline. Same density question.
- **Billing Readiness.** Tab strip, blocker cards, invoice grid, provider dispatch surface. Same.
- **AI Inbox `/inbox`.** Single-screen surface — should be fine — but the classification card with confidence chip + key facts strip + suggested action button may stack awkwardly.

**Recommendation:** before redesigning these, walk the live URLs on a phone for 10 minutes with the following checklist:

1. Is the first row of each list readable without zooming?
2. Are the most-used buttons in each surface tappable on first try?
3. Does scrolling reach the bottom of every card without horizontal scroll?
4. Does the keyboard appear correctly when tapping email/phone/number inputs?
5. Does any modal/drawer overshoot the viewport?

Anything that fails goes into a follow-up review with specific evidence.

## 4. Tenant portal — special case

The just-shipped "Complete your onboarding" panel (`tenant-portal-content.tsx`, commit `9af7462`) ships with `md:grid-cols-2` collapsing to single column at <768px. That is correct. The concern is *length*, not layout: 10 fields plus two checkboxes plus a notes textarea plus the existing portal sections below means a tenant on a phone sees a long vertical scroll on first arrival. Whether that is friction depends on how often a tenant is expected to return to the panel:

- If a tenant fills it once and submits, the long scroll is fine — every field is read-once and committed.
- If tenants are expected to come back and edit, the form should be split into sectioned accordions ("About you" / "Contact" / "Insurance" / "Emergency contact") so they only expand what they need.

**Recommendation:** flag for Remba — this is the surface most tenants will actually use, and tenants are external. It is the one place in the internal-first-6-months direction where mobile polish has external visibility.

## 5. Prioritised backlog

In order of user impact × implementation cost:

1. **Tenants list mobile card view** (verified, small slice, biggest reach).
2. **44px touch targets on header icon cluster** (verified, trivial slice).
3. **Tenant detail onboarding row mobile collapse** (verified, medium slice).
4. **Settings tab strip horizontal scroll verification** (verified, near-trivial slice if missing).
5. **Phone-validation pass over Notifications / Operations / Billing Readiness / Inbox** (10-minute walk; not a redesign yet).
6. **Tenant portal onboarding panel sectioning** (Remba-pending — design call needed before code).

Items 1-4 can ship as a single mobile-polish-v2 commit; item 5 is research; item 6 needs Remba sign-off first.

## 6. Out of scope

External-facing aesthetics (branded marketing pages, dark mode, illustration polish) remain deprioritised under the SKJ internal-first-6-months direction. The tenant portal is the one tenant-visible surface where mobile polish does matter, and it is called out in §4.

---

This review is not Remba-approved. It is an input for the next Remba review and a working backlog for the mobile-polish-v2 slice.
