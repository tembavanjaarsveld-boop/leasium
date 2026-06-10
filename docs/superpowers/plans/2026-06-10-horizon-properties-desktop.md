# Horizon Properties Desktop Slice

## Source of truth

- Figma file: `PO2jOANgmqgZHfqWZXOZGU`
- Frame: `55:2` (`03 Screens` / Properties)
- Scope: desktop Properties page only. Preserve existing Table, Map, Calendar, create/edit, image review, document, and all-entities behaviors.
- Status: implemented 2026-06-10, pending Remba review.

## Success criteria

1. `/properties` defaults to the Horizon Cards view, with Cards/Table/Map/Calendar switcher copy matching Figma.
2. Desktop content matches frame `55:2` at a glance: compact title/subtitle, three stat cards, 3-column card grid, add-property dashed tile, and review-first trust pill.
3. Existing dense table workflows remain reachable by selecting Table.
4. All-entities browse-only guardrail remains intact: `New property` disabled until a single entity is selected.
5. Verification covers targeted eslint, TypeScript, production build, relevant Playwright smokes, and browser checks at desktop/mobile.

## Plan

1. Add failing smoke coverage for Horizon Properties desktop default cards and all-entities guardrails.
2. Change route/workspace default from Table to Cards while preserving `?view=table|map|calendar`.
3. Implement Horizon stat cards and desktop property card grid using existing live API data and token classes.
4. Update existing smoke expectations that depend on the old Table default.
5. Update roadmap, design governance, and handover docs as Remba-pending.
6. Run targeted checks, browser-check desktop/mobile, commit, push, and verify Vercel.

## Result

Implemented as a frontend-only slice. `/properties` defaults to Cards; Table,
Map, Calendar, all-entities, selected-property deep links, image/evidence,
document, and billing workflows remain reachable. Card selection and
`property_id` deep links intentionally fall back to Table until Property detail
`58:627` ships.
