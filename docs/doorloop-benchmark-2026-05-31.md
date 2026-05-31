# DoorLoop Benchmark — Setting the Standard for Leasium (Australia)

Last updated: 2026-05-31
Author: Temba (research + analysis pass)
Purpose: Study DoorLoop's product, UX, and information architecture — especially its
"organise everything by **People** and **Properties**" model — and define exactly what
Leasium needs to reach (and then beat) that standard for the Australian market.

> **Source note.** The literal transcript of the requested 75-minute walkthrough
> (Darrel Wilson, *"Complete DoorLoop Tutorial For Property Managers"*,
> https://www.youtube.com/watch?v=rPOjKzW6ghA — Intro / Overview / Part 1 General
> Features / Part 2 Finances) could not be machine-pulled in this session (YouTube is
> blocked from the sandbox and no browser was connected). The analysis below is built
> from the video's section structure plus DoorLoop's own feature, navigation, owner,
> CRM and pricing pages, its Help Center, and third-party reviews (G2, Capterra,
> Software Advice, The Close). If you connect Chrome or paste the transcript, the exact
> demo wording can be folded in — but the substance here already covers the same ground.

---

## 1. The one-paragraph thesis

DoorLoop's strength is not any single feature — it is **structural clarity plus
consumer-grade simplicity**. Everything in the product hangs off two spines: **Properties
→ Units** and a single **People** hub that holds **Prospects → Tenants → Owners →
Vendors**, tied together by **Leases**, with **Accounting** and **Communications** as
cross-cutting layers. One left nav, collapsible sub-menus, global search, one shared
Notes/Files store, full mobile parity, and "free" white-glove onboarding/migration.
Leasium is, feature-for-feature, **already deeper than DoorLoop in several areas**
(document-AI Smart Intake, review-first guardrails, Xero/AU accounting, commercial-lease
depth, audit/provenance). But Leasium's **people are scattered** (Tenants, Contractors,
Owners-as-property-fields, and *no prospects at all*), its **surface count is high**
(~15 destinations vs DoorLoop's ~6 groups), and it is missing four DoorLoop pillars:
a **first-class Owner entity + owner portal**, a **leasing/CRM funnel**, **tenant
self-serve payments**, and **native mobile**. Closing the structural gaps — not chasing
every feature — is what lifts Leasium to the standard.

---

## 2. DoorLoop at a glance

| | |
|---|---|
| **What it is** | All-in-one cloud property-management platform: "Everything you need. Nothing you don't." One software, one login, no add-ons. |
| **Who it's for** | Property managers and owners managing residential (single/multi-family, student, mobile), commercial (retail/office/industrial), affordable housing, and HOA/community associations. |
| **Positioning** | "#1 Highest Rated" — ~4.8–4.9/5 across 700–1,000+ Capterra reviews; G2 leader. Privately owned, undercuts incumbents on price. |
| **Pricing (verified 2026-05-31)** | **Starter from $69/mo for the first 10 units** (billed yearly; ~"$3/unit" marketing), **Pro ~$149/mo**, **Premium ~$209/mo**. Annual saves up to ~20–25%. No lock-in contracts. Onboarding fee scales with portfolio size. AI is a paid add-on on Pro/Premium. |
| **Add-on economics** | Tenant screening $25–45 (TransUnion, chargeable to applicant); ACH $2.49 → free by plan; eSign $1–3/doc → free on Premium; marketing website $49–99/mo; merchant setup $25–49. |
| **Go-live** | "Days, not months." Dedicated migration team imports properties, units, tenants, **owners**, leases, and vendors from spreadsheets or other software. Dedicated account manager + free training. |
| **Platforms** | Web + native **iOS, iPad, Android** — "nearly every screen and feature on desktop is available in the mobile app." |

**The reported outcomes DoorLoop sells on** (their user surveys): 88% on-time payments,
~23 hours/month saved, 96% occupancy, and "up to 80% of tenant requests automatically
handled" by the AI Assistant. Treat these as marketing, but they signal where DoorLoop
points its value story: **time saved + cash collected + self-service**.

### What "simple design" actually means at DoorLoop

It is not minimalism — the product is huge. The simplicity is *architectural*:

- **One left nav, grouped, with collapsible sub-menus.** Top section = the work
  (Properties, Leases, People, Accounting, Communications); bottom = Settings. Click a
  group, the rail swaps to that group's sub-menu; click the title to go back. Hover
  tooltips on collapsed icons.
- **A global search** in the top bar reaches any record from anywhere.
- **One Notes store and one Files store** that aggregate every note/file regardless of
  which property/tenant/task created it — "one easy-to-search area."
- **Consistent record pages.** A tenant, owner, vendor and property all feel the same:
  header, tabs (Overview / Financials / Tasks / Notes / Files / Communications), same
  action patterns.
- **Mobile parity**, granular **user-access roles**, a **Calendar** that unifies
  move-ins/outs/tasks/work-orders, and **custom fields** on properties/units.
- **Workflows** (Triggers → Actions → Rules → Monitoring) let an operator automate
  repetitive sequences without code.

The lesson for Leasium is the *architecture*, not the surface area: fewer destinations,
each one a consistent hub, everything reachable from search.

---

## 3. DoorLoop's information architecture — the part you liked

This is the core of why DoorLoop "feels" organised. Two spines and two cross-layers.

```
DoorLoop
├── PROPERTIES
│     └── Units            (+ Portfolios = arbitrary groupings for reporting/dashboards)
├── LEASES                 (the connective tissue: ties a Unit ↔ Tenant ↔ money ↔ dates)
├── PEOPLE                 ← one hub for every human/relationship
│     ├── Prospects/Leads  (CRM: first contact → application → screening → signed lease)
│     ├── Tenants          (portal: pay rent, requests, insurance, messages)
│     ├── Owners           (portal: real-time dashboards, statements, distributions)
│     └── Vendors          (limited-access users: assigned jobs, post updates)
├── ACCOUNTING             (bookkeeping, bank sync, reports, QuickBooks, 1099s, budgets)
├── COMMUNICATIONS         (email/SMS, announcements, logs, templates)
├── NOTES  ·  FILES        (cross-cutting, aggregated, searchable)
└── SETTINGS               (roles, branding, region/currency, integrations)
        +  Global Search · Calendar · Workflows · AI Assistant (everywhere)
```

The decisive idea: **People is a single concept with four sub-types.** A prospect who
signs becomes a tenant; the same record model carries owners and vendors. DoorLoop's own
help text proves it — to assign an owner a task you *"navigate to **People**, then
**Owners**."* Their CRM page calls it "your single source of truth for every **prospect,
tenant, and owner** relationship." That one design choice is what makes the product legible.

---

## 4. DoorLoop feature map by module

| Module | What's inside | Notes for AU |
|---|---|---|
| **Accounting** | Per-property chart of accounts, bookkeeping, **live bank sync + reconciliation**, financial statements (balance sheet, P&L, cash flow, owner statements), budgeting, **1099s**, **QuickBooks Online** two-way. | US-centric: QuickBooks + 1099. AU equivalent = **Xero + BAS/GST**, which Leasium already does. |
| **Leasing / Marketing (CRM)** | **CRM pipeline** (lead → applied → screened → signed), **listing syndication** (Zillow/Trulia/HotPads/Dwellsy), **rental applications** (custom URL per property, fees, co-applicants, save-progress, reminders), **TransUnion screening** (criminal/credit/eviction), **eSignature** + lease-renewal wizard, free marketing **websites**. | AU equivalent = **realestate.com.au + Domain** syndication; **Equifax/illion** + **MyID/Stripe Identity** for screening. Mostly residential-letting flows. |
| **Operations** | **Work orders / maintenance**, **vendor management + vendor portal**, **owner portal**, **file storage**, **mobile app**, **Workflows** automation. | Leasium has maintenance + contractors; missing vendor *portal* and owner *portal*. |
| **Resident experience** | **Tenant portal** (pay rent, requests, insurance, announcements, 2-way messaging), **RapidRent** online rent collection (card/ACH/Apple-Google Pay/cash via Western Union), **renters insurance** (Lemonade/Sure), **communication tools**. | AU equivalent = **BPAY/PayTo/PayID/direct debit**; renters-insurance marketplace is residential. |
| **Owners** | **Owner portal** (24/7 real-time dashboards: vacancies, balances, P&L, net income), instant reports, **owner distributions + contributions**, **owner statements in real time**, **property ownership report** (shared %/splits), **automatic management-fee deduction**, secure file share, owner Tasks. | This is the single biggest *structural* gap vs Leasium (see §7). |
| **AI & Automation** | **AI Assistant / Tenant Concierge** (answers tenant questions, "handles up to 80%" of requests), **Quick-Fill Finances** (invoice/expense entry), **Listing Generator**, **Communication Companion**, **Smart Summaries**, **AI Inspections**, **Workflows**. | DoorLoop's AI is tenant-facing + autonomous. Leasium's AI is operator-facing + review-first (deliberately). |
| **Commercial depth** | **CAM charges + CAM reconciliation** (true-ups, pro-rata by sq ft, tenant statements). | Direct analog to AU commercial **outgoings reconciliation** — relevant to SKJ. |
| **Platform** | Global search, Calendar, custom fields, user-access roles, audit logs (Premium), 5,000+ integrations + open API/Zapier, automated backups, 2FA, SSO. | Leasium matches most of this already. |

### What DoorLoop users complain about (do *not* copy these)

- **Per-unit pricing creates sticker shock** at scale, and has risen over time.
- **Limited customisation** of reports and lease-agreement templates.
- **Cannot break expenses down per-unit** — only per-property. (A real accounting limit.)
- **Slow payment processing** — 3–5 business days to release funds; setup "confusing."
- **Tenant move-in/move-out setup is clunky** — "too many steps."
- **Long support waits** despite the "world-class support" positioning.

These are Leasium's opening: AU-native money rails, customisable reporting, unit-level
costing, and a genuinely smooth onboarding are all places to *beat* the standard, not match it.

---

## 5. Leasium today — honest current state

Leasium is **feature-rich and, in places, ahead of DoorLoop** — but it grew module by
module, so its structure has not been organised around People + Properties the way
DoorLoop's is.

**Data model (backend `stewart/core/models.py`).** Organisation → Entity → Property →
TenancyUnit → Lease → Obligation, plus Tenant, RentChargeRule, MaintenanceWorkOrder,
ArrearsCase, **Contractor**, InvoiceDraft/BillingDraft, TenantOnboarding,
TenantPortalAccount, StoredDocument, DocumentIntake, XeroConnection, BasiqConnection,
OwnerStatementDispatch, InsightsSnapshot, BrandedCommunicationTemplate.

**Crucial structural facts:**

- **There is no `Owner` entity.** Owners exist only as ~11 *fields on Property*
  (`owner_legal_name`, `owner_abn`, `trustee_name`, `trust_name`, `invoice_issuer_name`,
  `billing_contact_name`, `billing_email`, `ownership_split`, `owner_gst_registered`,
  `xero_contact_id`, `invoice_reference`). Owner "statements" are *computed* by grouping
  properties on an owner-identity tuple. **No owner login/portal exists.**
- **There is no Prospect / Lead / Applicant concept at all.** The entire leasing funnel
  (listings, applications, screening, eSign-to-lease) is unbuilt backlog.
- **Vendors = Contractors** — a real directory exists (`/contractors`, AI category
  matching, priority), but contractors have **no portal/login**.
- **Tenants are strong**: onboarding, portal account, maintenance requests + photos,
  document provenance, notification prefs, lifecycle controls.

**Current navigation (left sidebar):** Dashboard · Smart Intake · Properties · Tenants ·
Work · Billing · Insights · Portfolio QA · Settings — **plus** discoverable surfaces:
Contractors, Comms, AI Inbox, Statements, Notifications, Reports, Snapshots, Tenant
Portal. That is **~15+ destinations**. DoorLoop exposes **~6 groups**. Leasium's people
are split across *Tenants*, *Contractors*, *Statements* (owners), and nowhere (prospects).

**Where Leasium is genuinely ahead of DoorLoop** (don't lose these — they *are* the AU standard):

- **Smart Intake** — drop a contract/lease/invoice/certificate and AI extracts → matches →
  shows confidence + provenance → applies only on review. DoorLoop has nothing of this depth;
  its AI "Quick-Fill" is shallow by comparison.
- **Review-first guardrails + full audit/provenance** on every provider action (Xero write,
  SendGrid, Twilio, reconciliation). DoorLoop fires actions directly.
- **AU-native accounting**: Xero two-way + **Basiq** bank feeds (vs DoorLoop's
  QuickBooks/Stripe US stack).
- **Commercial-lease depth**: outgoings, options, rent reviews, make-good, bank guarantees,
  multi-entity / trust ownership structures.
- **Operator-facing AI that is safe**: Ask Leasium (cited Q&A), AI Inbox triage → reviewed drafts.

---

## 6. The People model — side by side (the centrepiece)

This is the comparison you specifically asked for. DoorLoop wins on **one unified People
hub with four first-class sub-types**; Leasium has the data but not the structure.

| People type | DoorLoop | Leasium today | Gap |
|---|---|---|---|
| **Prospects / Leads** | First-class CRM: lead source, pipeline stage, follow-up tasks, applications, screening, convert-to-tenant. | **Does not exist.** | 🔴 Whole funnel missing |
| **Tenants** | Directory + portal (pay, requests, insurance, messages, announcements). | Directory + portal (requests, docs, prefs) — **no in-portal payment**. | 🟡 Strong; no pay rail |
| **Owners** | First-class **People → Owners** + **owner portal** (real-time dashboards, statements, distributions, ownership %). | **Property fields only**; statements computed; **no owner login**. | 🔴 No owner entity/portal |
| **Vendors / Contractors** | First-class + **vendor portal** (limited-access users assigned jobs, post updates). | Contractor directory + AI matching — **no vendor portal**. | 🟡 Directory yes; no portal |

```
DoorLoop:  PEOPLE ─┬─ Prospects ─┬─ Tenants ─┬─ Owners ─┬─ Vendors      (one hub, 4 tabs)
                   └──────────────  all share record shape, tasks, notes, files  ──────────┘

Leasium:   Tenants (nav)      Contractors (nav)      Statements≈Owners (nav)      [no Prospects]
           └ scattered across separate destinations; Owner is not even an entity ┘
```

**The single highest-leverage change in this whole document:** promote **Owner** to a
first-class entity and gather Tenants + Owners + Vendors (+ later Prospects) under one
**People** hub. Everything else — owner portal, owner-level reporting, distributions,
a CRM — becomes *possible* only once Owner is a real record instead of property metadata.

---

## 7. The Properties model — side by side

| Concept | DoorLoop | Leasium | Verdict |
|---|---|---|---|
| Property → Unit | Properties contain Units; Property Setup Wizard (sq ft, market rent, ownership %). | Property → TenancyUnit. | ✅ Parity |
| Grouping | **Portfolios** = arbitrary groupings for reports/dashboards. | **Entity** (legal entity) is the only grouping; no free-form portfolio. | 🟡 Add portfolio grouping |
| Leases | **Top-level Leases** section. | Leases live *inside* the property workspace; no global Leases surface. | 🟡 Consider a Leases hub |
| Custom fields | Yes, on properties/units. | Provenance/metadata exists; no operator-defined custom fields. | 🟡 Minor gap |
| Commercial outgoings | **CAM reconciliation** (true-ups, pro-rata by sq ft). | Outgoings charge rules + obligations; reconciliation is manual. | 🟡 Automate true-ups |

Properties are close to parity. The opportunities are **Portfolio grouping**, an optional
**global Leases surface**, and **automated outgoings/CAM true-ups** (high value for SKJ's
commercial book).

---

## 8. Feature-by-feature comparison matrix

Legend: ✅ strong · 🟡 partial · 🔴 missing · ⭐ Leasium ahead of DoorLoop

| Capability | DoorLoop | Leasium | Priority to close (SKJ context) |
|---|---|---|---|
| Document-AI intake (drop file → records) | 🔴 shallow | ⭐ Smart Intake | — (keep the lead) |
| Review-first guardrails + audit/provenance | 🟡 | ⭐ | — (keep the lead) |
| AU accounting (Xero + GST/BAS) | 🔴 (QuickBooks/US) | ⭐ | — (keep the lead) |
| Bank-feed reconciliation | ✅ (US) | ⭐ Basiq (AU) | — |
| Commercial lease depth (outgoings/options/make-good) | 🟡 | ⭐ | — |
| **Unified People hub** | ✅ | 🔴 scattered | **P0 (structural)** |
| **Owner entity + owner portal** | ✅ | 🔴 fields only | **P0 (structural)** |
| Tenant portal | ✅ | ✅ | — |
| **Tenant self-serve payments (rent rail)** | ✅ RapidRent | 🔴 view-only | **P1 (AU rails)** |
| Maintenance / work orders | ✅ | ✅ | — |
| Vendor/contractor directory | ✅ | ✅ | — |
| **Vendor portal (assign + post updates)** | ✅ | 🔴 | P2 |
| **Leasing CRM (prospect → signed)** | ✅ | 🔴 | **P1 product / P3 for SKJ-internal** |
| Listing syndication | ✅ (US portals) | 🔴 | P3 (AU: REA/Domain) |
| Tenant screening | ✅ (TransUnion) | 🔴 | P3 (AU: Equifax/illion) |
| eSignature → lease | ✅ native | 🟡 DocuSign helper | P2 finish |
| Communications (email/SMS, logs, templates) | ✅ | 🟡 Comms queue (review-first) | P2 polish |
| **Native mobile apps** | ✅ iOS/Android | 🔴 responsive web only | **P1** |
| Owner distributions + auto mgmt fees | ✅ | 🔴 | P2 |
| Reporting / dashboards | ✅ (customisable on Premium) | 🟡 Insights + exports | P2 |
| Workflows / automation builder | ✅ visual | 🟡 comms automations, no builder | P2 |
| AI tenant concierge (autonomous) | ✅ | 🔴 (by design, operator-first) | Decide stance |
| Guided onboarding / data migration | ✅ white-glove | 🟡 spreadsheet import + QA | P2 |
| Calendar (move-ins/outs/tasks) | ✅ | 🟡 dashboard lease events | P2 |
| User-access roles | ✅ granular | ✅ entity roles | — |

---

## 9. The gaps that matter, ranked (with the SKJ lens)

Weighted for SKJ's reality — a **commercial owner using Leasium internally** for the first
6 months — *and* for the longer goal of being the DoorLoop-class **standard in Australia**.

**P0 — Structural, do first (unlocks everything else, low net-new feature count):**

1. **Make Owner a first-class entity.** Migrate the 11 property owner-fields into an
   `Owner`/`OwnerEntity` record linked to properties (1 owner → many properties; support
   ownership splits). This is the keystone — owner portal, owner reporting, and
   distributions all depend on it.
2. **Introduce a unified People hub** (Tenants · Owners · Vendors, with a Prospects tab
   stubbed). Consolidate today's scattered Tenants/Contractors/Statements destinations.
3. **Consolidate the IA** from ~15 destinations to ~6–7 hubs with sub-menus (see §10).

**P1 — Reaches the standard (what makes it feel like DoorLoop, AU-correct):**

4. **Owner portal** — read-only first: real-time dashboard (their properties, occupancy,
   arrears, P&L), statements on demand, document share. Review-first dispatch already exists
   for statements; this gives owners self-serve access.
5. **Tenant self-serve payments — AU rails.** PayTo / PayID / BPAY / direct debit (e.g.
   Monoova, Zai/Assembly, or Stripe AU). Keep Leasium's review-first stance for
   *reconciliation*, but let tenants actually pay. This is DoorLoop's #1 value driver.
6. **Native mobile (or installable PWA first).** Operator field use (inspections, photos,
   approvals) + tenant portal on a phone. A PWA is weeks; native is the later bet.

**P2 — Rounds it out:**

7. Owner **distributions + automatic management-fee** deduction.
8. **Vendor portal** (contractors log in, accept jobs, post updates/photos).
9. Finish **eSign → lease** (DocuSign helper exists) and the **Communications hub**
   (templates + logs are partly there).
10. **Customisable reporting** + a **Calendar** surface + a **Workflows** builder.

**P3 — Product-for-the-AU-market bets (lower priority while SKJ-internal/commercial):**

11. **Leasing CRM funnel** (prospect → application → screening → signed). Essential to be
    *the AU standard as a product*; low value for SKJ's commercial-owner internal use now.
12. **Listing syndication** (realestate.com.au + Domain) and **AU screening** (Equifax/illion,
    MyID/Stripe Identity). Both already sit in the roadmap as `[ ]`.

---

## 10. Proposed Leasium IA restructure (the "lift to standard" map)

Fold ~15 destinations into **7 hubs**, each with sub-menus — DoorLoop's pattern, AU-correct,
and keeping Smart Intake front-and-centre as Leasium's signature.

```
Leasium (proposed)
├── DASHBOARD            command centre + Ask Leasium + activity feed (as today)
├── SMART INTAKE         ⭐ keep prominent — Leasium's differentiator (Inbox + spreadsheet)
├── PROPERTIES           Properties → Units · Leases · Portfolios · Documents
├── PEOPLE               ← NEW HUB
│     ├── Tenants        (existing)
│     ├── Owners         (NEW first-class entity + portal)
│     ├── Vendors        (existing Contractors, renamed/rehoused)
│     └── Prospects      (stub now; CRM later)
├── WORK                 Maintenance · Arrears · Tasks · Comms (as today, consolidated)
├── MONEY                Billing Readiness · Invoices · Owner Statements · Xero · Bank feeds
└── INSIGHTS             dashboards · snapshots · reports
        SETTINGS · Global search · (Portfolio QA folds into Properties or Settings)
```

What this buys you: the **People hub** answers exactly the DoorLoop quality you liked;
**Money** unifies the finance sprawl (Billing/Statements/Xero/Basiq); **Work** unifies
operations + comms; surface count drops by more than half without removing any capability.
*(This is a design-facing/navigation change — exactly the kind of thing to prototype and
sanity-check before it ships, per `docs/design-governance.md`.)*

---

## 11. What "the DoorLoop standard, but for Australia" means

Copying DoorLoop's US stack would be wrong. The standard, localised:

| DoorLoop (US) | Leasium (AU standard) |
|---|---|
| QuickBooks Online + 1099s | **Xero + GST/BAS** (already built) |
| Stripe / ACH / Western Union cash | **PayTo · PayID · BPAY · direct debit** (Monoova / Zai / Stripe AU) |
| TransUnion screening | **Equifax / illion** + **MyID / Stripe Identity** |
| Zillow / Trulia / HotPads syndication | **realestate.com.au + Domain** |
| Lemonade / Sure renters insurance | AU insurer panel (later; residential) |
| Generic "compliance" | **State RTAs, bond authorities (RTBA/NSW Fair Trading), commercial Retail Leases Acts, trust-account rules for licensed agents** |
| CAM reconciliation | **Outgoings reconciliation / true-ups** (commercial — high SKJ value) |

Leasium is already further down the AU path than DoorLoop ever will be (Xero, Basiq,
commercial depth, trust/entity structures). The job is to wrap that AU substance in
DoorLoop's *legibility*.

---

## 12. Risks / what to deliberately not copy

- **Per-unit pricing** that punishes scale — design AU pricing to avoid the sticker-shock
  reviewers complain about.
- **Autonomous tenant-facing AI.** DoorLoop lets AI resolve tenant issues directly;
  Leasium's review-first guardrail (`CLAUDE.md` §2.1) is a deliberate, defensible
  difference. Decide consciously how far to let AI act tenant-side — don't drift into it.
- **Shallow reporting / no per-unit costing.** Beat DoorLoop here rather than inherit it.
- **Slow payment settlement + clunky move-in.** If/when payments ship, make settlement
  fast and move-in a single guided flow.

---

## 13. The shortest path (if you do only three things)

1. **Owner becomes a real entity** and **People** becomes one hub (Tenants/Owners/Vendors).
2. **Owner portal (read-only)** on top of that entity.
3. **Tenant payments on AU rails** (PayTo/PayID/BPAY), reconciled review-first.

Those three move Leasium from "deep but sprawling internal tool" to "DoorLoop-class
platform with an Australian spine" — without abandoning Smart Intake, the review-first
guardrails, or the Xero/commercial depth that already make it better than DoorLoop where
it counts.

---

## Sources

- DoorLoop — Features: https://www.doorloop.com/features
- DoorLoop — Pricing: https://www.doorloop.com/pricing
- DoorLoop — Owner Portal: https://www.doorloop.com/features/owners
- DoorLoop — CRM (prospects/leads): https://www.doorloop.com/features/crm
- DoorLoop Help Center — Navigation: https://support.doorloop.com/en/articles/6974026-learn-how-to-navigate-doorloop
- Video (structure only): *Complete DoorLoop Tutorial For Property Managers*, Darrel Wilson — https://www.youtube.com/watch?v=rPOjKzW6ghA
- Reviews / pros & cons: G2 (https://www.g2.com/products/doorloop/reviews), Capterra (https://www.capterra.com/p/211768/DoorLoop/reviews/), Software Advice (https://www.softwareadvice.com/property/doorloop-profile/), The Close (https://theclose.com/doorloop-review/)
- Leasium internal: `docs/product-roadmap.md`, `stewart/core/models.py`, `apps/web/src/app/*`
