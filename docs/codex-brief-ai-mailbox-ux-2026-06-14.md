# Codex Brief — AI Mailbox in-loop UX pass (2026-06-14)

**Owner agent:** Codex. **Parallel with:** Claude on Ticket 1 (Comms
send-time template consumption — backend + comms-draft preview). **Write
sets are disjoint:** you own `apps/web/src/app/inbox/*`, the alias/trusted-
sender Settings surfaces, and their smokes; Claude owns `comms.py` dispatch,
`branded_templates.py`, and the comms draft preview. Do not revert unrelated
changes — other sessions are live in this repo.

## Why this ticket

AI Mailbox backend + read-only `/inbox` are fully shipped and pushed
(through `afb08b0` virtual client aliases). The only open AI Mailbox work is
the **in-loop UX pass / design sync** — explicitly listed as remaining in
`docs/next-build-instructions-2026-06-12.md` Ticket 5 and in the UX Debt
Register (`docs/design-governance.md` §UX Debt Register). This is design-
facing, so it runs the **in-loop UX gate** (CLAUDE.md §2.2), not a code-only
slice.

## Scope (UX pass, presentation-only — no API shape changes)

From the UX Debt Register entry "AI mailbox intake UI" and Ticket 5's closing
paragraph, the surfaces that owe a pass:

1. `/inbox` AI Mailbox panel — **placement** in the page, **trusted-vs-
   quarantine** visual distinction, **provenance density** (auth detail,
   raw-email link, original sender), and the **copy-address** affordance.
2. **Trust / discard** action placement + copy in the selected-message
   detail panel (trust only on authenticated `sender_not_trusted`; failed-
   auth rows discard-only — keep that logic, review only the presentation).
3. **Review email → Review promotion** placement on trusted rows, the
   promote **provenance-card density**, and **per-kind copy** for the
   shipped variants (`compliance_or_insurance`, `property_update`,
   `task_or_reminder`, `owner_or_entity_admin`).
4. **Virtual alias management** UI + **Settings → Organisation trusted-
   sender** list/add/revoke — these shipped from existing Settings patterns
   and owe their own 1440/390 UX pass + design sync.

## Hard guardrails (non-negotiable — CLAUDE.md §2.1)

- Presentation only. **No** change to API shapes, classification logic,
  promote payload, trust/discard eligibility rules, or provider/apply
  guardrails. No acknowledgement replies, provider sends, Smart Intake
  apply, tenant email, Xero/Basiq, payment, or reconciliation.
- Pull the target design from Figma `AI Mailbox Intake 82:2` via the Figma
  MCP (`get_design_context`, `get_screenshot`) — don't infer style from the
  current code. Use Horizon tokens / the design source of truth; no ad-hoc
  tokens or components.

## In-loop UX gate (must complete in-session — §2.2)

1. Design first against Figma `82:2`; if a frame is missing for alias/Settings
   management, add/duplicate one and get Temba's sign-off before code.
2. Build to spec from Figma + `docs/leasium-codex-design-source-of-truth.md`.
3. UX pass before "done": run the UX gate checklist in
   `docs/design-governance.md`, capture **real screenshots at 1440px and
   390px**, apply the hallmark slop test to any new/restructured surface, fix
   findings in-slice.
4. Log it: one dated line in the UX Pass Log (`docs/design-governance.md`),
   and remove the "AI mailbox intake UI" entry from the UX Debt Register if
   this pass covers it (or note what's deferred + why).

## Verification (fresh evidence required — §2.8, §2.6)

Frontend runs on Temba's Mac via Desktop Commander (sandbox can't):
- `eslint src` + `tsc --noEmit` on touched files.
- Targeted smokes for `/inbox` and Settings trusted-sender — run with
  `NODE_ENV=development` (the DC shell defaults to production and crash-loops
  next-dev); clear stale prod `.next` first.
- Production `next build` with the bundled WASM SWC.

## Commit / push (§2.4, §2.5, Vercel note)

Terse imperative subject, file-by-file body, **no** Claude/Codex attribution.
Commit with the **gmail author identity** (private-repo Hobby plan blocks
deploys of `temba@skjcapital.com`-authored commits). Stage only this ticket's
files — `git status --short` before staging. If `.git/index.lock` is stale,
rename it rather than unlink. Push only on Temba's go; verify the Vercel
deploy goes READY.

## Docs to update on ship

- `docs/design-governance.md` — UX Pass Log line + Debt Register edit.
- `docs/product-roadmap.md` — mark the AI Mailbox UX pass done.
- `docs/next-chat-handover.md` — current state + verification evidence.
