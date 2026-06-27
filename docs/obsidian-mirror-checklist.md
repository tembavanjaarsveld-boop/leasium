# Obsidian Mirror Checklist

Last updated: 2026-06-27

Relby's canonical product brain lives in:

`/Users/tembavanjaarsveld/Documents/Temba OS/10_Projects/Relby`

The Stewart repo remains canonical for exact code, tests, migrations,
deployment setup, recent commits, and implementation proof.

## Generated Handover

Run this from the Stewart repo to refresh the coding handover:

```bash
.venv/bin/python scripts/generate_obsidian_handover.py
```

Use check mode in verification when you only want to confirm the mirror is
current:

```bash
.venv/bin/python scripts/generate_obsidian_handover.py --check
```

## Read Order

Before changing generator inputs or manually refreshing any repo doc from the
vault, read:

1. `/Users/tembavanjaarsveld/Documents/Temba OS/00_System/AI_START_HERE.md`
2. `/Users/tembavanjaarsveld/Documents/Temba OS/10_Projects/Relby/PROJECT.md`
3. `/Users/tembavanjaarsveld/Documents/Temba OS/10_Projects/Relby/Brain/CURRENT_BRAIN_STATE.md`
4. `/Users/tembavanjaarsveld/Documents/Temba OS/10_Projects/Relby/Brain/ACTIVE_WORK.md`
5. `/Users/tembavanjaarsveld/Documents/Temba OS/10_Projects/Relby/Brain/PRODUCT_OPERATING_RULES.md`
6. `/Users/tembavanjaarsveld/Documents/Temba OS/10_Projects/Relby/Brain/REPO_MIRROR_PLAN.md`
7. `git status --short`
8. `git log --oneline -12`

## Refresh `docs/next-chat-handover.md`

Prefer the generator command above. Manual edits should be limited to fixing the
generator or its vault inputs.

Keep the handover under 300 lines.

Use the vault for:

- product direction,
- active priorities,
- durable decisions,
- AI handover context,
- current caution flags.

Use the repo for:

- current git state,
- recent commits,
- exact files touched by shipped work,
- verification commands,
- implementation-specific caveats.

## Refresh `docs/product-roadmap.md`

Use the vault for current priority and direction, then record shipped
implementation proof in the repo roadmap.

Do not copy long historical vault notes into the roadmap. Keep history in the
repo archive or vault archive.

## Conflict Rule

If the vault and repo disagree on product direction or priority, surface the
mismatch before editing.

If the vault and repo disagree on exact code behavior, inspect the repo and
tests.

## Guardrails

- No Xero write, SendGrid email, Twilio SMS, tenant email, payment action, or
  reconciliation without explicit operator approval.
- Smart Intake remains review-first.
- Design-facing work still needs the in-loop UX gate.
- Do not delete unrelated repo or vault changes while refreshing mirrors.
