# Leasium AI — Conversation-first redesign (concept v3)

Status: **Figma concept + clickable prototype done; pending Temba sign-off
before implementation.** 2026-06-15.
Figma: file `PO2jOANgmqgZHfqWZXOZGU`, frames on page `01 Foundations`
at x≈11200 (a fresh page would not persist through the remote MCP, so the
concept set lives beside the existing token/AI-Mailbox art). Section title
"Leasium AI — Conversation-first redesign (concept v3)".

Frame node ids:
- Home (desktop) `148:52` — flow start
- Understanding + plan (desktop) `153:52` — the hero
- Created + next steps (desktop) `155:52`
- Ask a question (desktop) `155:205`
- Old paid invoice (desktop) `155:298`
- Home (mobile) `158:52`
- Understanding + plan (mobile) `158:117`

ON_CLICK prototype links Home → Understanding → Created → Ask → Old invoice
→ Home (and mobile Home ⇄ Understanding).

## Why redesign

The shipped `/intake` "Leasium AI" is a **review panel wearing a chat
costume**. The triage/summary layer reads documents well (the queue summary
for the Gorilla Grind lease is rich and accurate), but the review panel
gates on a separate **structured-field** extraction that returned 0 fields,
so the "chat" can only do one scripted move: ask "what should this become",
take a free-text reply, and **echo it back** as a "review-only preview". It
cannot answer questions, cannot create the tenants it already named in the
apply plan, and presents two mental models (intake vs ask). Six iterations
on 2026-06-15 all re-skinned the costume.

## Principles

1. **One thread, many turns.** The conversation is the surface. Dropping a
   document, asking a question, reviewing an extraction, and approving an
   action are all turns. Structured artifacts (understanding tables, action
   plans, source evidence) render as rich **cards inside the thread**, not a
   separate three-column workspace.
2. **Read once, act everywhere.** The understanding *is* the plain-English
   summary. Do not gate action on a brittle structured-field pass. If
   structured fields are thin, still propose records from the summary, with
   low-confidence values flagged for confirmation. A lease that names Gorilla
   Grind proposes Property + Unit + Tenant + Lease.
3. **Bundled plan, one confirm.** Decided with Temba: a dropped lease whose
   tenants/units don't exist yet produces ONE proposal — "I'll create the
   property, units, tenant Gorilla Grind, and the lease — confirm?" — with
   inline-editable values and a single "Create all records".
4. **Guardrails preserved and made visible inline (CLAUDE.md §2.1).**
   Internal records (property/unit/tenant/lease/tasks/critical dates) are
   created on confirm. **Provider actions — Xero post, SendGrid email, Twilio
   SMS, tenant email, payment, reconciliation — stay a separate, explicit
   approval even after the create**, shown as a teal gate note and per-row
   "Needs approval / Review".
5. **Global agent (decided with Temba).** One persistent Leasium AI reachable
   everywhere via the ⌘K command bar already in the Horizon shell. `/intake`
   becomes one full-screen entry point, not the home of a separate product.
   On a Property page, "add the lease for these tenants" carries page context.
6. **Old/paid documents handled usefully.** A paid historical invoice
   (INV-0331) is recognised as settled and offered as "file as a paid record"
   or "attach as evidence" — never posted to Xero, charged, or emailed.

## Screen set (built)

- **Home** — conversation composer centre-stage ("drop a document, ask a
  question, or tell me what to do"), quick-action chips, a Read→Propose→Approve
  explainer, recent threads, and the AI review queue rail with status chips.
- **Understanding + plan (hero)** — user drops the lease; AI replies in plain
  English; a "What I understood" card lists every term with HIGH/MED confidence
  and a 🔗 to the source clause; an amber flag raises the REIQ term-vs-options
  inconsistency; then the blue **Proposed plan** card (Property, 2 units,
  Tenant, Lease, optional critical date) with one "Create all records",
  "Edit before creating", and the teal provider-gate note. Source rail on the
  right keeps the document and a cited snippet visible.
- **Created + next steps** — green confirmation listing the linked records
  created, then "Suggested next steps" (Sync to Xero, Set up rent invoicing,
  Email the tenant) each marked NEEDS APPROVAL with its own Review, plus the
  guardrail note and a reply composer.
- **Ask a question** — same thread answers "when does the lease end / what's
  the rent" with citation chips and follow-up suggestions. Proves one AI does
  Q&A and documents.
- **Old paid invoice** — recognises the paid May rent invoice, declines to
  post/charge/email, and offers file/attach/ignore.
- **Mobile (390)** — Home and the Understanding+plan hero, with bottom nav.

## Open decisions for Temba (before build)

1. Does "Create all records" need a confirm dialog, or is the proposal card
   itself the confirmation? (Lean: card is the confirm; show an undo toast.)
2. How much does the global ⌘K agent carry across pages in v1 — full thread
   history, or just a contextual launcher that opens the workspace?
3. Editing a proposed value inline vs opening the field editor — depth for v1.
4. Where does the thread/transcript persist (review_data vs a first-class
   conversation record)? Affects "Recent" and cross-device history.

## Build note

This is a UX/IA concept, not code. Implementation should reuse the existing
review-first apply path (it already creates property/unit/tenant/lease with
provenance) behind the new conversational surface, and must keep every
provider mutation review-first per §2.1.
