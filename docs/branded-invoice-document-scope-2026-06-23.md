# Branded Invoice Document — Scope

Internal scope/plan. Last updated: 2026-06-23. Status: pre-design (Figma-first
gate not yet started).

Goal: replace the bare, text-only invoice PDF with a branded, professional AU
tax invoice that each Entity controls, managed under Settings, with a live
preview — without touching the review-first provider guardrails.

---

## Current state (why the invoices look terrible)

- The invoice PDF is hand-built byte-by-byte in `_invoice_pdf_bytes()`
  (`apps/api/routers/charge_rules.py:415–478`): Helvetica 11pt, fixed margins, a
  42-line cap, no library. It prints invoice number, issuer/recipient, due date,
  total, and line items as plain text. **No logo, colour, letterhead, layout, or
  GST presentation.**
- The on-screen preview (`_invoice_preview_html()`,
  `charge_rules.py:604–696`) is semantic HTML with inline styles only — no brand,
  no design tokens.
- The only "template" system today is `BrandedCommunicationTemplate`
  (`stewart/core/models.py:1496–1558`) which covers **email/SMS copy only**
  (`subject_template`, `body_template`) — e.g. the `invoice_delivery` email. It
  does **not** model document design.

Net: data is correct; presentation is a placeholder. For an AI-first product the
*output* undercuts the rest of the experience.

---

## Target

A clean AU **tax invoice** that:
- carries the Entity's branding (logo, accent colour, legal name, ABN, address,
  contact, payment details, footer/terms);
- presents line items with per-line GST and a correct tax summary
  (subtotal / GST / total), honouring each charge's GST treatment and Xero tax
  type;
- shows AU payment rails the tenant actually uses (PayID / BPAY / EFT — display
  only; no payment processing implied);
- renders identically in the on-screen preview and the generated PDF;
- is versioned, so a template change doesn't silently alter already-issued
  invoices.

See the companion mockup: `docs/mockups/branded-invoice-mockup.html`.

---

## Information architecture (placement)

**Settings → "Branding" (per Entity).** Rationale: branding is org/account
configuration, it matches where customers expect it (Xero/Stripe/DoorLoop), it
sits beside the per-Entity Xero integration that posts the invoices, and it
honours the 7-item sidebar cap (no new top-level nav — CLAUDE.md §2.10).

Must be **per-Entity**: each trust/company invoices under its own name, ABN and
logo, and Xero is already per-Entity.

Single source of truth: brand assets live **once** here and are consumed by the
invoice document, owner/entity statements, the `invoice_delivery` (and other)
Comms email templates, and the tenant portal — not duplicated. The Comms email
templates stay in Comms but read the shared brand assets; cross-link the two so
"the invoice document + the email that delivers it" are obviously related.

Settings → Branding contains:
1. **Brand assets** — logo upload, accent colour, legal/trading name, ABN,
   address, contact, payment details (PayID/BPAY/EFT), default footer/terms.
2. **Invoice template** — layout choice (start with one good default),
   live preview against a sample invoice, and version history.

---

## Proposed data model

- **`EntityBranding`** (new, one per Entity): `entity_id`, `logo_document_id`
  (→ `StoredDocument`), `accent_color`, `legal_name`, `abn`, `address`,
  `contact_email`, `contact_phone`, `payment_details` (JSON: PayID/BPAY/EFT),
  `footer_terms`, audit columns. Editing it is a local config change — no
  provider effects.
- **Invoice template versioning** — reuse the `BrandedCommunicationTemplate`
  pattern (key + `version` + `is_system` + per-entity override falling back to an
  in-code default) for a `document`/`invoice` channel, OR add a small
  `InvoiceTemplateSetting` carrying the active version + layout id. Each issued
  invoice records the template/brand version used (in `invoice_metadata`) so
  re-rendering is deterministic and auditable.

---

## Rendering approach (key technical decision)

Today there is **no PDF library** — the bytes are hand-rolled. To get a branded
document we need a real renderer. Two options:

- **A. HTML template → PDF via a Python renderer** (e.g. WeasyPrint). One HTML/CSS
  template drives both the on-screen preview and the PDF, so they can't drift.
  Adds a system dependency (WeasyPrint needs native libs) to the Render image.
  Recommended — single source of truth for layout, easy to brand with CSS vars.
- **B. Headless-browser render** (Playwright/Chromium). Highest fidelity, heavier
  runtime/infra.

Recommendation: **A**, with the template built from the approved Figma frame and
brand assets injected as CSS variables. Confirm the WeasyPrint dependency is
acceptable on Render before building.

Guardrail: rendering is entirely internal (produces/refreshes the StoredDocument
artifact). It does **not** email, post to Xero, or dispatch — those stay the
existing explicit steps. Loading or previewing mutates nothing.

---

## Phased plan

1. **Design first (Figma).** New invoice frame in the design source of truth +
   Temba sign-off (CLAUDE.md §2.2/§2.12). The HTML mockup here is the starting
   point, not the spec.
2. **Settings → Branding (assets).** `EntityBranding` model + per-Entity editor
   (logo upload, colour, business details, payment rails, footer). No render yet.
3. **Render pipeline.** Replace `_invoice_pdf_bytes`/`_invoice_preview_html` with
   one branded HTML/CSS template fed by EntityBranding + the invoice draft;
   shared by preview and PDF. Stamp template/brand version onto the artifact.
4. **Preview + versioning in Settings.** Live sample preview; version history;
   "what issued invoices used which version".
5. **Wire into the run.** Billing Readiness "prepare" produces the branded
   artifact; the `invoice_delivery` email reads the same brand assets.
6. **(Later) statements & receipts** reuse the same engine.

Each slice ships with the UX gate (1440/390 screenshots, slop test, UX-pass log)
and tests (backend happy + error path; smoke for the visible flow).

---

## Guardrails (unchanged)

- No Xero write, tenant email, SMS, or payment from any of this — branding,
  preview, and render are all local.
- Smart Intake / AI surfaces stay review-first; this work doesn't change them.
- Per-Entity scoping throughout; all-entities mode shows per-entity branding.

---

## Open decisions for Temba

1. **Renderer dependency** — WeasyPrint on Render acceptable (option A)? If infra
   is sensitive, we weigh B.
2. **One template or several** — start with a single polished default (recommended)
   vs. a small library to choose from.
3. **AI assist** — optional later step: read an uploaded sample invoice and pre-fill
   brand assets (colour/logo/layout hints) for review. Nice-to-have, not phase 1.
4. **Statements** — fold owner/entity statements into the same engine now or later.
