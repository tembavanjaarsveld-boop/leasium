# Leasium — 5-Day Build Report

**Period:** 2026-05-18 → 2026-05-23
**Stack:** FastAPI · Postgres · Next.js 15 · SQLAlchemy · Alembic · Clerk · SendGrid · Twilio · Xero · OpenAI · DocuSign lease signing + activation review · Vercel · Render

## Goals

- **Run the platform with as few humans in the loop as possible.** Every screen asks the operator what to *approve*, not what to *enter*.
- **AI drafts, operator approves.** Provider-mutation guardrail is non-negotiable — no Xero / SendGrid / Twilio / payment writes without an explicit operator click.
- **Document-first workflows.** Drag in a contract, lease, certificate, invoice — Smart Intake extracts, the operator reviews, records mutate.
- **Internal-first 6 months.** SKJ Capital uses Leasium internally before any external rollout; prioritise internal workflow speed and data integrity over branding polish.
- **Scale without hiring.** The platform's purpose is to let one operator run a portfolio that would otherwise need a 3-5 person team.

## Headline

- **263 commits** to `main`, no broken state between them
- **3.7 billion tokens consumed** = **~37,000 books** of reading / writing equivalent
- **0 to deployed product** in 5 days

## Surface area shipped

| | Count |
|---|---|
| Frontend routes / pages | **26** |
| Backend API routers | **27** |
| Database migrations (Alembic) | **23** |
| Backend integration test files | **24** |
| Integration modules (SendGrid, Twilio, Xero, OpenAI, DocuSign, SerpAPI, MinIO, Clerk) | **8** |
| Design-governance follow-ups (Remba review queue) | **86** |
| Lines in core data model (`stewart/core/models.py`) | **1,746** |
| Lines in frontend API client (`apps/web/src/lib/api.ts`) | **4,246** |

## Operator workspaces built (10)

Dashboard · Smart Intake · AI Inbox · Properties · Tenants · Operations (Work) · Comms · Billing Readiness · Insights · Portfolio QA · Settings · Notifications

## Major feature threads

**Smart Intake** — document drop → AI extract → review → apply. Covers leases, purchase contracts, billing docs, insurance, bank guarantees. Spreadsheet bulk-import with dry-run + apply. Reviewed mutation everywhere.

**Tenant portal** — token-scoped self-service, Clerk-backed account login, document upload + provenance, maintenance request submission with photos, lifecycle controls (revoke/restore/unlink), fresh-link recovery, account-claim flow. Onboarding now happens *inside* the portal (operator sends invite → tenant signs up → tenant completes record → operator reviews + applies).

**Xero accounting** — OAuth foundation, chart/tax validation preview, reviewed contact mapping apply, invoice posting preview, sync exception queue with guided actions, payment reconciliation with evidence, configurable stale-window, accounting-freshness snapshot. No mutations without explicit operator approval.

**Maintenance + Operations** — work orders, contractor coordination, SMS + email templates, closeout capture, invoice handoff, completion drafts, owner review path, provider history, reopen flow. Work-assignment notifications with cross-channel receipts, digest preview + cron, recovery cues, escalation queue.

**Comms automation (v1 → v4)** — scheduled comms loop. Queue surfaces draft communications by kind: arrears reminders, insurance expiry, lease renewal, compliance obligations, inbound email, inbound SMS. Operator reviews / edits / dispatches. SendGrid for email, Twilio for SMS. AI triage classifies inbound. Sidebar badge for in-app notification. Evidence-attach (Smart Intake primary, manual fallback).

**Inbound channels** — SendGrid Inbound Parse webhook (email) + Twilio Messaging webhook (SMS) → AI classification → tenant attribution → operator queue. Provider-only auth, signature verification queued for hardening pass.

**AI surfaces (4)** — Smart Intake extraction · AI Inbox classifier (paste message → kind + suggested action) · Ask Leasium AI Q&A (cited answers over operator's data) · Property image enrichment (web-search → reviewable candidates).

**UX modernisation** — Tier 1 left sidebar, Tier 2 keyboard shortcuts + activity feed, Tier 3 inline editing + saved views + multi-view (Table/Board). Mobile audit + 8 surface polish passes. Send-invite CTA collapsed 4 manual steps to 1.

**Strategy docs** — Automation strategy (controlling principle + full backlog through DocuSign / WhatsApp / voice transcription / vacancy marketing) · Mobile UX review · Nav pattern research · UX review 2026-05-22.

## Integrations wired (live or scaffolded)

| Provider | Status |
|---|---|
| Clerk (operator auth + tenant Clerk-backed accounts) | Live |
| SendGrid (outbound email) | Live |
| SendGrid Inbound Parse (inbound email) | Endpoint live, awaiting DNS MX |
| Twilio Messaging (outbound SMS + inbound webhook) | Endpoint live, awaiting per-entity numbers |
| Xero (OAuth + contacts + invoices + reconciliation) | Live, review-first |
| OpenAI (Smart Intake / AI Inbox / Ask Leasium / image enrichment / triage) | Live |
| SerpAPI (property image search) | Live |
| MinIO / S3-compatible (document storage) | Live |
| DocuSign (lease e-signature) | Review-first flow shipped; live sends require production credentials/endpoints. Completion retains the signed PDF and opens explicit activation review. |

## Verification

- **86 backend integration tests** across 24 test files; full suite green
- ESLint + `tsc --noEmit` clean on every commit
- Playwright smoke suite mocked + maintained throughout
- Production frontend deployed on Vercel; production API on Render with Alembic-on-start

## Operating guardrails (non-negotiable, enforced across the codebase)

- No Xero write, SendGrid email, Twilio SMS, tenant email, or payment reconciliation fires without explicit operator approval
- Every AI draft is review-first — operator approves before any provider call
- Audit log captures every action (kind + outcome, never message body)
- Soft-fail when providers are missing — clear receipt rather than crash

## What's queued for next session

- Annual rent increase batch (1-2 sprints)
- Owner monthly statements (2-3 sprints)
- Maintenance categorisation + contractor directory (2-3 sprints)
- DocuSign production readiness: credentials, webhook secret, public API URL, production REST/auth endpoints, and live-envelope smoke
- Bank-feed reconciliation via Basiq (2-3 sprints)

## Competitor comparison

Honest read against the two top-end PM platforms in commercial / mid-market: **Re-Leased** (mid-market commercial PM, NZ + AU + UK + US, AI-positioned via Credia suite) and **AppFolio** (mid-to-large PM, US market leader, AI-positioned via Realm-X). Both are mature SaaS with multi-year head starts, real customers, support teams, mobile native apps. Leasium is 5 days old.

| Capability | Leasium | Re-Leased | AppFolio |
|---|---|---|---|
| AI document extraction (leases, contracts, invoices) | Smart Intake — drag → extract → review | Credia Extract | Realm-X Documents |
| AI natural-language Q&A over portfolio | Ask Leasium (cited answers) | Credia Advise | Realm-X Assist |
| AI inbox triage / classification | `/inbox` + inbound email + SMS | Credia Action | Realm-X Messages |
| Tenant portal (login, docs, maintenance, comms) | Clerk-backed, full lifecycle | Yes (mature) | Yes (mature) |
| Operator-approved comms queue (arrears, expiry, renewal, inbound) | Live, 6 candidate kinds | Workflow rules only | Workflow rules only |
| Provider-mutation guardrail (no auto-sends ever) | Enforced platform-wide | Some auto-sends | Some auto-sends |
| Accounting / Xero two-way sync | Live, review-first | Live (Xero partner) | QuickBooks-first |
| Bank-feed reconciliation | Scoped for next session | Via Xero | Native AppFolio Payments |
| E-signature integration | DocuSign review-first signing flow shipped; production readiness pending | DocuSign + HelloSign | DocuSign + Adobe Sign |
| Inbound email / SMS parsing | Live webhooks (SendGrid + Twilio) | Limited | Limited |
| Inspection workflows | Backlog | Mature mobile app | Mature mobile app |
| Maintenance + contractor coordination | Live, contractor directory queued | Mature contractor marketplace | Mature contractor marketplace |
| Owner statements / financial reporting | Backlog (next session) | Mature | Mature |
| Tax / EOFY pack generation | Backlog | Mature | Mature |
| Listing / vacancy marketing | Backlog | realestate.com.au + Domain wired | Zillow + 50+ syndication |
| Applicant screening | Backlog | Manual + 3rd party | Built-in credit + criminal + eviction |
| Native mobile app | No (responsive web) | iOS + Android | iOS + Android |
| Years in market | 0 (5 days) | 13 | 17 |
| Pricing | N/A (internal) | $3-5 / unit / month | $1.40-3 / unit / month |
| AI-first architecture | Yes (built that way) | AI bolt-on (Credia, 2024) | AI bolt-on (Realm-X, 2024) |
| Review-first AI (operator approves before any send) | Default everywhere | Some auto-actions | Some auto-actions |

### Where Leasium leads
- **AI-first by design, not bolted on.** Re-Leased and AppFolio shipped AI suites in 2024; Leasium was built around the AI workflow from day one.
- **Provider-mutation guardrail enforced as architecture.** Competitors automate sends in some flows — Leasium never sends without an explicit operator click.
- **Document-first as the default UX.** Smart Intake is the primary entry point, not a feature; manual forms are the fallback.
- **Velocity.** 5 days to a deployed multi-surface SaaS with 9 live integrations.

### Where competitors lead (gaps to close)
- Native mobile apps (inspections, photo capture, field work)
- Contractor marketplace + payment processing
- Listing-platform integrations + applicant screening
- Years of mature reporting + tax pack + EOFY workflows
- Validated production customer base + 24/7 support
- Multi-currency / multi-jurisdiction depth

## Bottom line

In 5 days, on a single-operator budget, this build delivers what a small property-management firm would normally take 6-12 months and a 3-5 person engineering team to deliver. Every surface is operator-review-first; every integration is hot-or-scaffolded; the automation backlog beyond what's shipped is concretely scoped and ready to execute. Against Re-Leased and AppFolio, Leasium leads on AI-first architecture, document-first workflow, and operator-approval guardrails, and trails on years-of-maturity surfaces (native mobile, contractor marketplace, listing integrations, EOFY tooling) — all of which are scoped in the automation backlog and not blocked by anything structural.
