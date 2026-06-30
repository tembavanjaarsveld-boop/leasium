# Guided Invoice Setup Design

## Goal

Make per-Entity branded invoice setup obvious enough that a non-technical
operator can complete it from a checklist and live preview, without knowing how
Relby stores branding, renders PDFs, versions templates, or protects provider
actions.

## Design Direction

Use a guided setup, not a power-user template editor.

The main user promise is:

> Complete these few steps and Relby will make your tax invoice look
> professional.

The experience should feel like setting up a phone or email account: one clear
step at a time, sensible defaults, persistent progress, and a preview that shows
what the user is changing.

## Primary Surface

Primary route context: `Settings -> Organisation -> Comms/Branding`.

The existing `Branding` tab should become an `Invoice setup` workspace with:

- a readiness card: `Not started`, `Needs details`, or `Ready`;
- a four-step checklist;
- a live sample invoice preview;
- a primary action that changes by state:
  - `Start invoice setup`;
  - `Continue setup`;
  - `Use this invoice style`;
  - `Edit invoice setup`.

The current placeholder copy, `Branding defaults use the trust profile`, is not
enough. It tells the user where data comes from, but not what to do next.

## Guided Steps

### 1. Who Sends The Invoice?

Collect or confirm:

- legal/trading name shown on the invoice;
- ABN;
- business address;
- contact email;
- contact phone.

Rules:

- Pre-fill from Entity fields and existing settings where available.
- Use helper text: `These details appear at the top and bottom of your tax
  invoice.`
- Do not ask for Xero settings in this step.

### 2. What Should It Look Like?

Collect or confirm:

- logo upload when available, otherwise initials/monogram;
- accent colour;
- footer/terms text.

Rules:

- Start with one default layout.
- Do not show a template gallery in v1.
- The preview should update when the accent colour or initials/logo changes.

### 3. How Should Tenants Pay?

Collect or confirm:

- PayID;
- BPAY biller code and reference;
- EFT BSB and account number.

Rules:

- Present these as payment instructions, not payment processing.
- Use copy such as: `Shown on invoices only. Relby does not take payment from
  this setup.`
- Allow optional methods to be skipped with `Add later`.
- Suggest invoice number as the EFT reference where no fixed reference exists.

### 4. Check And Save

Show:

- a sample AU tax invoice preview;
- readiness checks:
  - sender details present;
  - GST summary present;
  - at least one payment method present;
  - no provider action will run;
- primary action: `Use this invoice style`.

Rules:

- Saving branding is local configuration only.
- If the user changes invoice setup later, already-prepared invoice artifacts
  should remain auditable through stored metadata.

## Secondary Surface: Billing Readiness Nudge

Billing Readiness should not become a second settings editor.

If invoice setup is missing or incomplete, Billing Readiness should show a
plain nudge:

`Finish invoice setup before preparing tenant-facing invoice documents.`

The action is `Finish invoice setup`, and it opens the same guided flow. The
operator can still review draft billing data, but the tenant-facing document
should not be presented as ready until setup is complete.

## Components

Use existing Relby/Horizon patterns:

- `SectionPanel` for the Settings workspace.
- Compact tab rail under Organisation/Comms where needed.
- Status badges for readiness.
- Existing buttons, empty states, form inputs, and drawers.
- A responsive invoice preview panel with stable dimensions.

Avoid:

- nested cards inside cards;
- large marketing hero sections;
- explaining renderer/template internals in visible copy;
- dense tables of configuration fields;
- multiple invoice template choices in v1.

## Data Flow

1. Settings loads the selected Entity.
2. Settings fetches the Entity branding record.
3. Missing values are displayed as guided setup gaps, not as a blank technical
   form.
4. The sample invoice preview is rendered from:
   - current form values;
   - sample invoice data;
   - the same brand shape used by invoice draft preview/PDF rendering.
5. Saving writes local Entity branding configuration and audit metadata only.
6. Billing Readiness reads the same readiness state before preparing invoice
   documents.

Provider calls are not part of this flow.

## Error Handling

- If branding load fails, show: `Invoice setup could not load. Try again before
  preparing tenant-facing invoice documents.`
- If save fails, keep the user's entered values on screen and show the failing
  fields or retry guidance.
- If logo upload is unavailable in the first slice, show initials as the default
  and make logo upload a clearly labelled future enhancement.
- If no payment method is entered, allow saving as draft setup but keep the
  readiness state at `Needs details`.
- If Billing Readiness encounters incomplete setup, do not block local draft
  review, but do block the `ready for tenant document` state.

## Testing And UX Gate

Backend tests:

- Empty branding returns an incomplete readiness state.
- Saving branding updates local Entity branding and does not call Xero, email,
  SMS, payment, or reconciliation providers.
- Saved branding feeds invoice preview/render data.

Frontend smoke tests:

- Settings -> Branding shows the guided setup entry state.
- User can fill sender, visual, and payment details in the guided flow.
- Sample invoice preview reflects entered brand values.
- Billing Readiness shows the `Finish invoice setup` nudge when branding is
  incomplete.
- Provider/send/sync/payment/reconciliation routes are not called by setup or
  preview.

UX gate:

- Figma frame approved before code.
- Desktop screenshot at 1440px.
- Mobile screenshot at 390px.
- Slop test passes: no confusing hierarchy, broken wrapping, hidden primary
  action, cramped touch target, or provider-risky wording.
- Add a dated entry to `docs/design-governance.md`.

## Out Of Scope

- Sending tenant invoice emails.
- Posting or syncing invoices to Xero.
- Taking tenant payments.
- Payment reconciliation.
- Multiple invoice templates.
- AI-assisted logo/sample-invoice import.
- Owner/entity statements and receipts.
- Full renderer replacement unless required by the approved Figma design.

## Open Decisions

- Whether logo upload lands in the first implementation slice or initials ship
  first with logo upload immediately after.
- Whether the current Pillow renderer can satisfy the approved Figma frame, or
  whether HTML-to-PDF replacement is needed before PDF polish.
- Exact URL state for the Settings sub-section, likely
  `/settings?tab=organisation&section=branding&setup=invoice`.
