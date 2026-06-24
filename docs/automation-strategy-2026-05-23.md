# Leasium Automation Strategy — 2026-05-23

## 1. The principle

Leasium's product purpose is to take work *off* the operator. Every screen should answer "what does the operator need to *approve* right now" rather than "what data does the operator need to *enter* right now."

This is the controlling design principle. It supersedes feature requests that ask the operator to author something the AI could draft. It coexists with — and does not relax — the provider-mutation guardrail in `CLAUDE.md`: AI drafts, operator approves, then the SendGrid/Twilio/Xero call fires. The point is to make approval the *only* human action, not to remove the human entirely.

This principle is consistent with two other source-of-truth docs:

- `CLAUDE.md` §2.3 — internal-first six months; deprioritise external polish in favour of internal workflow speed.
- `docs/ux-review-2026-05-22.md` — "the work moves toward the operator, not the other way around."

A useful test for any proposed feature: does it reduce the number of *moments per week* an operator has to look at the platform, or the number of *fields per moment* they have to type? If neither, it does not advance the strategy.

## 2. What is already automated

Honest read of the current state. Most of these are review-first — they surface AI work for human approval, which is correct given the guardrail, but they do not yet reduce the *frequency* of approval moments.

- **Smart Intake.** Drag a document → AI extracts → operator approves → records created.
- **AI Inbox (`/inbox`).** Paste a message → AI classifies + suggests a Leasium surface to take it from there.
- **Ask Leasium (`/api/v1/ai/ask`).** Natural-language Q&A over the operator's data with cited record IDs.
- **Activity feed.** Cross-property audit projection on the Dashboard.
- **Property image enrichment.** Web-search → reviewable image candidates → operator approves → stored.
- **Public enrichment.** OpenAI web-search for property data, review-first.
- **Lease document extraction.** Lease PDF → structured fields → operator review.
- **Tenant portal onboarding.** Tenant completes their own record from inside the authenticated portal; operator reviews and applies.
- **Tenant portal maintenance.** Tenant submits work orders with photos directly.
- **Branded communication templates foundation.** `branded_communication_template` table exists; not yet consumed by send pipes.
- **Operator notifications.** Rendered message previews, channel receipts, provider history.
- **Workflows Builder v1.** On-demand, review-first rule engine in Work
  (`/operations?tab=workflows`) with fixed trigger catalog
  `lease_expiring` / `arrears_threshold` / `compliance_due` and fixed action
  catalog `create_task` / `notify_operator` / `queue_comms_draft`. Evaluation
  mirrors the comms queue pattern: page load or explicit Evaluate derives
  proposals from existing records, never sends, never posts to Xero/Basiq,
  never reconciles, and never mutates source/provider records. Operator
  approval is required per proposal; comms drafts still go through the existing
  Comms review/send gate.
- **Saved views, inline edit cells, mobile card view.** Reduce navigation friction.

What is not yet automated: scheduled comms loops, inbound messaging, document folder watchers, bank-feed reconciliation, calendar/inspection scheduling, lease renewal prep, annual rent increases, owner statements, compliance reminders, contractor coordination beyond a single send, vacancy marketing, voice/call intake.

## 3. Automation backlog

Grouped by the kind of human time it removes.

### 3a. Communications repetition — biggest immediate time-sink

| Automation | What it removes | Required inputs | Effort |
|---|---|---|---|
| **Arrears reminder ladder** | Operator types nudge → firm reminder → default notice. AI drafts each from the arrears history + lease; operator approves. | None new — uses existing arrears + lease + branded template tables. | 1 sprint. |
| **Document-chase reminders** | Operator manually tracks "Mia's insurance expires in 28 days" then types a reminder. AI detects approaching expiry + drafts the reminder. | None new. | 1 sprint (combined with arrears as one "scheduled comms loop"). |
| **Lease event drafts** | Lease expires in 90 days → AI drafts a renewal-discussion email referencing current rent, market range, breaches. | None new for v1; market-rate data is a future enrichment. | 1 sprint. |
| **Maintenance status forwarding** | Tenant submits → contractor confirms → operator forwards to tenant → contractor done → operator forwards invoice. Each forward is mechanical. | None new. | 1-2 sprints (touches the work-order timeline). |
| **Annual rent increases** | Per-lease formula (CPI / fixed / market) → AI generates notice + draft email + updated charge rule. | None new (formula stored per lease). | 1 sprint. |
| **Owner monthly statements** | Per-owner monthly compile of rent received / outgoings / fees → PDF + email draft. | None new. | 1-2 sprints. |

### 3b. Inbound channels — biggest data gap

Today the AI Inbox needs the operator to *paste* a message. Real automation means messages arrive *to* Leasium directly.

| Automation | Required inputs | Effort |
|---|---|---|
| **Inbound email** | SendGrid Inbound Parse webhook + DNS MX record. AI classifier + tenant/lease attribution. | 1 sprint + SendGrid + DNS. |
| **Inbound SMS** | Twilio Studio flow → webhook. Each property/portfolio gets a unique number. | 1 week once email is done (shared classifier). |
| **WhatsApp Business** | WhatsApp Business API approval, template messaging quotas. | 2-3 weeks; Meta approval gates this. |
| **Voice / phone calls** | Twilio Voice + Whisper transcription. Each tenant call becomes a transcript + AI summary on the tenant timeline. | 2-3 sprints. Big bet. |

### 3c. Document ingestion at the source

Smart Intake handles documents the operator drops in. The next step is documents arriving on their own.

| Automation | Required inputs | Effort |
|---|---|---|
| **Email attachment parser** | Inbound email (above) → attachments routed to Smart Intake → AI extracts → operator reviews. | Included with inbound email. |
| **Folder-watch sync** | Dropbox / Google Drive / OneDrive OAuth + polling worker. | 1 sprint per provider. |
| **e-Signature / DocuSign** | DocuSign Connect webhook + envelope create API. Lease sent for signature from within Leasium; completed envelope retains the signed PDF, records provider completion, and creates a lease activation review. The operator must explicitly activate the lease. | 2-3 sprints; DocuSign developer account + envelope template setup. |

### 3d. Financial automation — high value, more risk

| Automation | Required inputs | Effort |
|---|---|---|
| **Bank-feed reconciliation** | Basiq (AU) or Plaid (international) feed → AI matches each transaction to expected charges → operator approves a batch. Removes ~80% of reconciliation hours. | 2-3 sprints; needs operator-facing bank-link OAuth. |
| **Xero invoice draft auto-sync** | Stricter version of the existing Xero contact/posting preview — AI generates the invoice batch monthly, operator approves. | 1-2 sprints (extends existing Xero work). |
| **Trust account compliance** | RBA-style monthly reconciliation report drafts. | 1 sprint after bank-feed lands. |

### 3e. Tenant lifecycle extensions

| Automation | Required inputs | Effort |
|---|---|---|
| **Tenant-uploaded lease auto-match** | Tenant uploads signed lease → AI extracts terms → diffs against Leasium's draft → if matched, the upload is accepted as the signed agreement and creates a lease activation review. Lease status is unchanged until the operator activates explicitly. | 1 sprint (extends existing lease extraction). |
| **Tenant-uploaded insurance** | Tenant uploads certificate → AI extracts insurer / policy / expiry → updates tenant metadata + sets a renewal obligation. | 1 sprint. |
| **Maintenance categorisation + contractor draft** | Tenant submits with photos → AI categorises (electrical / plumbing / urgent) → suggests a contractor from the operator's directory → drafts the contractor brief. | 1-2 sprints. |

### 3f. Compliance — the silent-failure surface

Insurance expiries, fire-safety certificates, smoke alarm checks, gas safety, council compliance. Date-driven obligations that currently rely on someone remembering.

| Automation | Required inputs | Effort |
|---|---|---|
| **Compliance obligations model** | `compliance_obligation` table (likely partly there as lease obligations). Recurring schedule per kind. | 1 sprint. |
| **AI-drafted reminders firing on schedule** | Same scheduled-comms loop as §3a. | Folded into 3a. |
| **Inspection report intake** | Operator runs an inspection → uploads notes + photos → AI extracts findings → creates work orders. | 1-2 sprints. |

### 3g. Big future bets

These are real and worth building, but later. They need substantially more setup, more provider integrations, or more risk than the items above.

| Automation | Why later |
|---|---|
| **Vacancy marketing copy generation** | AI drafts the realestate.com.au listing copy + photos + price recommendation. Requires market-rate data integration (RP Data / CoreLogic). |
| **Vacancy applicant triage** | Applications come in via listing platforms → AI summarises affordability + references + flags → operator approves shortlist. Requires listing platform integrations. |
| **Predictive maintenance** | Pattern recognition over inspection + work-order history. Suggests preventive jobs before they become reactive. Needs years of internal data to train usefully. |
| **Year-end tax pack generation** | Compiles annual statements for each owner. Touches tax accounting; needs accountant sign-off on the format. |
| **Council / statutory communication routing** | Inbound council letters → AI classifies + routes to the right property. Niche, low volume. |
| **Tenant self-serve rent adjustment** | Tenant requests rent relief via the portal → AI summarises affordability evidence → operator approves. High-trust, low-frequency. |
| **Automated lease termination** | Lease end-of-term → AI runs bond release → final account → tenant exit communications. Requires complete workflow modelling. |

## 4. Sequencing

The first six slices, ordered by leverage-to-build-cost ratio for SKJ's actual day-to-day:

1. **Scheduled comms loop v1** (arrears + document-chase + lease-event drafts). Uses what is shipped; biggest immediate hours-saved.
2. **Inbound email parsing.** SendGrid Inbound Parse → AI classifier → drafts. Closes the loop on AI Inbox.
3. **Inbound SMS.** Twilio inbound → same classifier. Cheap once email is done.
4. **Compliance obligation tracking + scheduled reminders.** Insurance / certificate / smoke-alarm expiries; reuses the comms loop dispatch.
5. **Bank-feed + AI reconciliation.** Biggest financial-time saver.
6. **Folder-watch document intake.** Dropbox / Drive / OneDrive sync into Smart Intake.

Then: annual rent increases, owner statements, DocuSign production readiness, WhatsApp.
Then: voice/call transcription, vacancy marketing, predictive maintenance, year-end tax pack.

## 5. Operating guardrails for every automation

Every item in this strategy ships under the same rules:

- **Provider-mutation guardrail.** No SendGrid / Twilio / Xero / tenant email / payment reconciliation fires without explicit operator approval. The AI's job is to draft and queue; the operator's job is to click yes.
- **Audit by default.** Every AI draft, every classification, every approval lands in the audit log with kind + confidence (not the body itself, since pasted messages can contain PII).
- **Soft-fail when providers are missing.** Without `OPENAI_API_KEY`, drafting endpoints return 503 with clear copy and do not mutate. Without `SENDGRID_API_KEY`, sends are recorded as `skipped` with a recovery hint.
- **Review-first surfaces, not autonomous.** Every automation lands as a queue or a draft, never as a fait-accompli send.
- **Inline edit at the moment of approval.** If the AI got the wording slightly wrong, the operator can fix it before sending — no round trip to re-draft.
- **Remba review for every visible queue or surface change.** Per `docs/design-governance.md`.

## 6. What this doc is not

This is not a Remba-approved plan. It is the input for the next Remba review cycle and a working backlog for the operator-facing parts. Numbers and effort estimates are rough — they should be sharpened when each slice is picked up.
