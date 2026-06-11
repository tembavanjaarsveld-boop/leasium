# Horizon Dashboard Mobile First Viewport

Date: 2026-06-11
Status: shipped pending Remba review
Figma source: `PO2jOANgmqgZHfqWZXOZGU`, Dashboard mobile `45:371`

## Goal

Bring mobile `/` closer to the locked Dashboard mobile frame without touching the
Dashboard data flow, provider paths, Smart Intake apply paths, or app shell.

## Plan

1. Pull the locked Figma mobile frame and identify the page-owned pieces under
   the existing mobile shell.
2. Add a failing mobile smoke for the cockpit, first-viewport hierarchy,
   touch-safe horizon rows, no horizontal overflow, and no provider/workflow
   mutations on load.
3. Implement mobile-only Dashboard presentation: greeting, Ask Leasium pill,
   compact hero, 2x2 bento cards, mobile horizon/trust placement, and restored
   mobile Refresh/demo controls below the trust pill.
4. Verify with targeted ESLint, TypeScript, Dashboard smokes, shared mobile
   route sweep, production build, and browser checks at 390x844 and 1280x900.

## Notes

- Desktop Dashboard remains the v2 `45:2` implementation.
- Mobile horizon shows two touch-safe rows before the trust pill so the real
  app shell bottom nav stays clear; Remba should review this compromise against
  the static Figma frame.
- No API shape, provider send, email/SMS, Xero/Basiq, payment, reconciliation,
  Smart Intake apply, or workflow mutation path changed.
