# Leasium AI — Capabilities Today & Roadmap

Internal planning doc. Last updated: 2026-06-23.

Purpose: a candid map of what the AI actually does in the product today, the
guardrails it runs under, where it falls short, and a prioritised view of what
an "AI-first" Leasium should do next. This is the source of truth for AI scope
decisions; keep it honest about gaps.

---

## The one-line shape of Leasium AI today

Every AI feature is **read → extract/suggest → a human reviews → only then does
anything change**. All of it runs on the OpenAI Responses API, is gated on
`OPENAI_API_KEY` (clean 503 when unset, no mutation), and **never** writes to a
provider on its own — no Xero post, tenant email, SMS, or payment runs without a
separate explicit operator approval (CLAUDE.md §2.1). That review-first posture
is the product's biggest trust asset and must survive every future change.

So today the AI is an **extraction-and-suggestion layer**, not yet an **agent**
that does work for you. The gap between those two is most of the roadmap below.

---

## What the AI does today (shipped)

### 1. Smart Intake — document understanding
Drop a document; Leasium reads it, structures it, and proposes records for
review. Five extractors back this:

- **Generic document intake** (`stewart/ai/document_intake.py`,
  `POST /document-intakes/extract`) — any lease/invoice/insurance/guarantee/
  compliance/notice → document type, summary, parties, dates, amounts,
  obligations, suggested links, warnings, confidence, and proposed actions.
- **Lease extraction** (`stewart/ai/lease_intake.py`,
  `POST /lease-intakes/extract`) — a lease → property + unit + tenant + lease
  (rent, frequency, review/option/security) + obligations, each field with
  confidence; one "create all" lands the whole record set for review.
- **Vendor/contractor intake** (`stewart/ai/vendor_intake.py`) — contractor
  email → name, ABN, contact, scope, trade category + suggested match.
- **Tenant contact extraction** (`stewart/ai/tenant_contact.py`) — inbound
  message → tenant legal/trading name, ABN, contacts, billing email.
- **Lease change detection** (`stewart/ai/lease_change.py`) — amendment/
  variation → changed terms (rent/expiry/tenant), key changes, warnings.

All land in the `/intake` review queue with provenance and an OpenAI response id
for audit. Nothing is created until a human approves.

### 2. AI Mailbox — triage & promote
- **Inbox triage** (`stewart/ai/inbox.py`, `POST /ai/triage`) — inbound email →
  classified kind (maintenance, arrears, lease change, tenant contact, vendor,
  compliance, task, owner/admin, general, spam), confidence, summary, suggested
  action + target, key facts.
- **Trusted-sender management + promote** (`POST /ai/triage/promote`) — trust or
  discard a sender; promote a triaged message into the right review surface
  (Smart Intake / Operations / a draft). No send, post, or dispatch from the
  mailbox itself — promote is a hand-off to an existing approval gate.

### 3. Ask Leasium — Q&A over the portfolio
`stewart/ai/ask.py`, `POST /ai/ask`. Natural-language questions ("when does the
Acme lease expire?") answered from a bounded portfolio context, **with required
citations** (property/lease/tenant/obligation/maintenance/arrears) and a refuse-
if-unsure instruction. Read-only; surfaced on the dashboard and intake, threads
persisted as first-class records.

### 4. Maintenance categorisation
`stewart/ai/maintenance.py`, `POST /maintenance/work-orders/{id}/classify`.
Classifies a work order (trade category, urgency), suggests a contractor from
the directory, and stamps `ai_classification` metadata. Suggestion only; dispatch
stays a separate approval.

### 5. Property enrichment (public web)
`stewart/ai/enrichment.py`, `POST /enrichment/*`. OpenAI web-search proposes
property images and public facts (suburb/zoning/ownership hints) as reviewable
candidates. The image apply path stores a processed, property-linked document
only after explicit review. Flagged experimental.

---

## Cross-cutting properties (the good foundations)

- **Review-first everywhere** — extract → confidence → source → approve/edit/
  ignore → only then mutate. Consistent across every surface.
- **Provenance & audit** — intakes keep the source document, the OpenAI response
  id, and who approved.
- **Citations** for Ask; **confidence** on most extractions; **warnings/missing-
  info** surfaced rather than hidden.
- **Hard provider firewall** — AI never triggers Xero/SendGrid/Twilio/payment.
- **Graceful degradation** — no key → clear 503, never a silent failure or a
  fabricated result.

---

## Where it falls short today (honest gaps)

1. **Confidence is coarse.** Most extractors return one document-level confidence,
   not per-field — so a reviewer can't see at a glance which two fields to check.
2. **No auto-matching.** Extracted tenants/properties/contacts are offered as
   free text; the operator manually picks the matching existing record. No fuzzy
   match against the portfolio.
3. **No duplicate detection.** Re-uploading a document (or a forwarded email)
   creates a fresh intake; nothing flags "you already processed this."
4. **No conflict checks.** A lease amendment that contradicts an existing
   obligation or critical date isn't flagged — the human has to notice.
5. **Suggestion-only, manual apply.** Even high-confidence, unambiguous results
   need a manual click each; there's no "accept all clear ones" batch.
6. **Branded output is absent.** Invoices (and statements) render from a hard-
   coded, text-only PDF — no logo, layout, or brand. (See the branded-invoice
   scope doc.) For an "AI-first" product, the *output* still looks un-designed.
7. **Read, not act.** The AI never drives a workflow end-to-end (e.g. "run this
   month's billing") — it informs, the human does each step.

---

## What it should do next (roadmap)

Tiered by horizon. Near-term items are concrete and buildable on the current
review-first architecture; the vision tier reframes the product around the agent.

### Near-term — deepen trust & cut clicks (weeks)
- **Per-field confidence + inline auto-match.** Show high/low confidence per
  field and pre-select the most likely existing tenant/property/contact with a
  one-click confirm or change. Biggest reviewer-time win.
- **Duplicate detection** on intake (document hash + fuzzy party/amount match).
- **"Approve all high-confidence" batch** in Smart Intake, with the low-confidence
  rows left for manual review — pairs naturally with the new one-click billing run.
- **Branded invoice & statement output** (the invoice scope doc) — the most
  visible quality gap; an AI-first product should produce polished documents.
- **Provider-readiness validation.** Before "ready to send", have the AI confirm
  the issuer ABN, tenant billing email, GST treatment, and Xero mapping are
  coherent, and explain anything missing in plain English.

### Mid-term — from suggestions to drafting & matching (1–2 quarters)
- **Agentic monthly-run assistant.** The AI proposes the whole month's invoice
  batch ("12 invoices, $X, 2 need attention"), you approve once; it still stops
  at the real provider gates. Extends the new one-click run.
- **Reconciliation matching.** Match bank-feed lines to open invoices with a
  confidence + reason, operator confirms (pairs with Basiq when un-parked).
- **Inbox reply drafting.** Draft tenant/contractor replies in the mailbox for
  review, instead of only classifying.
- **Obligation/critical-date conflict detection** across lease changes.
- **Insights Q&A deepening** — portfolio analytics and "what changed this month"
  narratives, still cited.

### Long-term — conversation-first operation (vision)
- **The agent as the primary surface.** The conversation-first concept (Figma
  prototype, `docs/leasium-ai-conversation-redesign-2026-06-15.md`) becomes the
  default way to operate: describe the outcome, the AI assembles the bundled
  plan, provider calls remain a separate gate.
- **Proactive monitoring** — the AI watches for arrears, expiries, compliance
  lapses, mis-mapped charges and surfaces them before you ask.
- **Document generation** — leases, notices, statements from templates (the same
  branded-template engine the invoice work introduces).
- **Multi-jurisdiction** lease/compliance understanding beyond AU.

---

## Prioritisation (impact × effort, near-term)

| Capability | Operator impact | Effort | Notes |
|---|---|---|---|
| Branded invoice/statement output | High (external-facing quality) | Med | Needs render pipeline + Settings branding |
| Per-field confidence + auto-match | High (every intake) | Med | Reviewer-time win; UI + match logic |
| Approve-all-high-confidence | Med-High | Low | Reuses review-first plumbing |
| Duplicate detection | Med | Low-Med | Hash + fuzzy match |
| Provider-readiness validation | Med | Low | Wrap existing readiness blockers in an AI explainer |
| Agentic monthly-run assistant | High | High | Sequencing + safety; build after the above |

---

## Non-negotiables for every future AI feature

- Stay review-first: extract → confidence → source → approve → mutate.
- Never fire a provider call (Xero/SendGrid/Twilio/payment) without explicit,
  separate operator approval.
- Always degrade cleanly without a model key; never fabricate.
- Keep provenance/citations so any AI output can be traced and audited.
