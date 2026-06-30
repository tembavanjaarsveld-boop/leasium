# Guided Branded Invoice Setup — Scope

Internal scope/plan. Last updated: 2026-06-30. Status: design direction
approved; Figma-first gate next.

Goal: make branded AU tax invoice setup simple enough that a non-technical
operator can finish it from a checklist and live preview, while Relby still
produces a professional per-Entity invoice document and keeps all provider
guardrails unchanged.

The north star is:

> Users are not configuring invoice templates. They are completing a guided
> setup so Relby can produce a professional tax invoice.

## Why This Scope Changed

The original 2026-06-23 scope was too implementation-shaped. It correctly
identified that the invoice output needed to become branded and professional,
but it led with renderer, data model, and template-versioning decisions.

Current repo state has also moved on:

- `EntityBranding` now exists as local per-Entity configuration with accent
  colour, address, contact, PayID/BPAY/EFT fields, and footer terms.
- The invoice renderer now uses `stewart/integrations/invoice_render.py` with
  `resolve_invoice_brand()`, a branded HTML preview, and a Pillow raster PDF.
- Settings already has a `Branding` tab under Message Templates, but it is an
  empty-state placeholder rather than a usable setup flow.

The remaining product problem is not "create a branding table". The remaining
problem is: **how will a normal user know what to do?**

## Approved Direction

Use **Guided setup first**.

Settings -> Branding should open with an `Invoice setup` card and readiness
state, then guide the user through four plain-language steps:

1. **Who sends the invoice?**
   Legal name, ABN, address, contact email, and phone. Pre-fill from the Entity
   and existing settings where possible.
2. **What should it look like?**
   Logo or initials, accent colour, and footer/terms. Start with one polished
   default layout, not a template library.
3. **How should tenants pay?**
   PayID, BPAY, and EFT details. These are display-only instructions. Relby
   does not process payment from this setup.
4. **Check and save.**
   Show a live sample AU tax invoice. The primary action is `Use this invoice
   style`.

The preview should stay visible throughout the flow on desktop and remain easy
to open on mobile. Every field should answer "where will this appear on the
invoice?"

## User Experience Rules

- Use plain words. Avoid "template version", "payment rails", "artifact", and
  "renderer" in the user path.
- Pre-fill aggressively. If Relby already knows the Entity name, ABN, email, or
  Xero-connected identity, start there and ask the user to confirm.
- Use forgiving completion states: `Not started`, `Needs details`, `Ready`.
- Allow `Add later` for optional payment methods such as BPAY when PayID or EFT
  is present.
- Keep one excellent default invoice layout for v1.
- Hide history, versioning, and audit detail behind a secondary `History` or
  `Advanced` affordance.
- Cross-link the invoice email: `Edit the email that sends this invoice`.
- Do not expose provider actions from setup.

## Information Architecture

Primary home:

- `Settings -> Branding -> Invoice setup`

Secondary nudge:

- Billing Readiness should detect missing or incomplete invoice setup and show
  `Finish invoice setup` before preparing tenant-facing invoice documents.
  This nudge must open the same guided setup, not a duplicate billing form.

Why Settings:

- Branding is per-Entity organisation/account configuration.
- Xero is already per-Entity, and invoice identity belongs beside that level of
  setup.
- This respects the seven-item navigation cap. No new top-level nav item.
- Brand assets should be shared by invoices, invoice-delivery emails, tenant
  portal invoice display, and later statements/receipts.

## Target Invoice Output

A clean AU tax invoice that:

- shows the Entity's legal/trading identity, ABN, address, contact details, logo
  or initials, accent colour, payment details, and footer terms;
- presents line items with GST treatment and subtotal / GST / total;
- displays only the payment methods the Entity uses: PayID, BPAY, EFT;
- uses the same brand/data source for on-screen preview and generated PDF;
- records the brand/template version used when an invoice is prepared, so
  already-issued invoices remain auditable.

## Technical Direction

Keep implementation choices behind the user experience.

The current lightweight path can be hardened first:

- continue using `EntityBranding` as the local per-Entity source;
- improve the Settings UI and sample preview before replacing render
  infrastructure;
- stamp brand/render version metadata when preparing the PDF artifact;
- keep the current provider-inert artifact path: preparing an invoice may create
  or refresh a `StoredDocument`, but it must not send email, post to Xero, sync,
  reconcile, or process payment.

Renderer replacement remains a later technical decision:

- WeasyPrint or browser-rendered HTML may still be the better long-term engine
  for higher fidelity.
- Do not block the user-facing setup flow on that choice unless the approved
  Figma invoice frame cannot be represented well by the current renderer.

## Phased Plan

1. **Figma-first design.**
   Create a current-platform Settings -> Branding -> Invoice setup frame and a
   sample AU tax invoice preview. Get Temba sign-off before code.
2. **Guided setup UI.**
   Replace the placeholder Branding tab with the checklist, pre-filled fields,
   readiness state, live preview, and save flow.
3. **Branding API hardening.**
   Extend `EntityBranding` only where the approved UI requires it, likely logo
   upload, legal/trading name override, ABN override, and version metadata.
4. **Preview and PDF alignment.**
   Ensure Settings preview, invoice preview, and generated PDF use the same
   brand/draft data. Stamp the version used onto invoice metadata and the stored
   artifact.
5. **Billing Readiness nudge.**
   If invoice setup is incomplete, show `Finish invoice setup` and route into
   the same guided setup before tenant-facing document preparation.
6. **Later reuse.**
   Owner/entity statements, receipts, and tenant portal invoice displays should
   consume the same brand source once invoice setup is stable.

Each code slice ships with the UX gate: approved Figma source, desktop/mobile
screenshots, slop test, UX pass log, and focused backend + smoke coverage.

## Guardrails

- No Xero write, tenant email, SMS, payment action, reconciliation, or provider
  mutation from branding setup, preview, or render.
- Smart Intake and AI surfaces remain review-first.
- Per-Entity scoping throughout.
- All-entities mode must show which Entity's invoice setup applies before
  preparing documents.

## Open Decisions

1. Logo handling: upload real logo in v1, or continue initials first and add logo
   upload in the next slice?
2. Renderer timing: harden current Pillow renderer first, or replace renderer
   before PDF polish if Figma fidelity requires it?
3. Statements: reuse this engine later after invoice setup works, not in the
   first guided setup slice.
