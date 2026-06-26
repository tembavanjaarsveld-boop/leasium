# Communication Templates Settings Redesign

## Goal

Redesign `Settings -> Organisation -> Comms` so the operator can quickly understand which Relby messages exist, what wording is active, and where to edit or preview that wording, without reading internal template keys first.

## Design Direction

Use the approved Horizon Settings style from Figma frame `55:439`: compact panels, short rows, small status badges, restrained copy, familiar icon+text buttons, and no large hero or card-heavy catalogue.

The section should be organised around business-language message types, not provider plumbing:

1. `Messages` is the default view. Rows include examples like `Tenant onboarding invite`, `Invoice delivery`, and `Work assignment SMS`.
2. Each row shows the channel, active/runtime/override state, current subject or short wording summary, and one obvious action: `Edit wording` when editable, `Preview` when runtime-only, or `Change version` when version selection exists.
3. Selecting a stored branded template row opens the existing comms template editor drawer. Selecting a runtime-only row opens a read-only preview drawer with an `Open full Comms hub` secondary action. Both drawer states keep key/version/provider visible but secondary.
4. `Branding` contains sender/reply-to/signature defaults for the selected trust or organisation. If those controls are not yet backed by API data, this tab shows a compact empty state that explains branding defaults still come from the selected trust profile.
5. `Delivery receipts` contains SendGrid/Twilio receipt endpoints and recent delivery evidence as read-only operational detail.
6. `Advanced keys` contains runtime keys, versions, override coverage, and CSV export. This replaces the current always-visible key/version/endpoint wall.

## Interaction Principles

- The first screen answers: "What messages does Relby send, and what wording is active?"
- The editing path is explicit from each row; the operator should not need to know that the editor lives in the Comms hub.
- Provider sends remain review-first. Previewing, editing, assigning, copying, or exporting templates must not send email/SMS, dispatch comms candidates, mutate provider history, reconcile payments, or touch Xero/Basiq.
- Runtime templates that cannot be edited yet should say why in plain language and offer preview/export only.
- Trust/brand scope should be visible in the row subtitle or badge, but not dominate the row.

## Desktop Layout

Inside the existing Organisation Comms content:

- Keep `AI mailbox aliases and trusted senders` as its own panel above templates.
- Replace the current `Communication templates` card grid with a single `Message templates` panel.
- Panel header: title, one-sentence description, count badges, and a secondary `Open full Comms hub` action.
- Use a small horizontal segmented control inside the panel: `Messages`, `Branding`, `Delivery receipts`, `Advanced`.
- `Messages` renders a row list, not nested cards.
- The right side of each row contains compact actions, no more than two visible buttons.
- The advanced tab may reuse the existing coverage/export content, but it should be visually demoted behind the tab.

## Mobile Layout

- Keep the same tab order.
- Rows stack into one column with the message title, subtitle, badges, and actions below.
- Buttons remain at least 44px tall.
- Advanced technical fields wrap and use `break-all` only inside code-like endpoint blocks.
- Bottom spacing must clear the mobile nav.

## Testing And UX Gate

- Add/update a smoke test that opens `/settings`, enters `Organisation -> Comms`, and asserts the simplified message rows and advanced tab are present.
- Assert loading the screen does not call provider/send/dispatch/payment/reconciliation paths.
- Run desktop and mobile Playwright screenshots at 1440px and 390px.
- Log the UX pass in `docs/design-governance.md` after screenshots and fixes.

## Out Of Scope

- New provider send behaviour.
- New SendGrid/Twilio webhook behaviour.
- New backend template schema.
- A second independent template editor that duplicates the Comms hub editor.
