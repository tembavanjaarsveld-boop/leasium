# Leasium — Codex Design Source of Truth

Use this single file as the design, brand, UX, and frontend implementation reference for Leasium.

Leasium is a modern lease and tenant management system. It should feel like a calm, intelligent SaaS command centre, not legacy property software.

---

## 1. Core brand direction

**Product name:** Leasium  
**Category:** Lease and tenant management software  
**Brand position:** A modern lease operations command centre that turns lease documents, tenant onboarding, billing readiness, attention items, and critical dates into review-first automated workflows.

**Primary tagline:**  
Lease operations, automated.

**Hero headline:**  
Run every lease from one command centre.

**Hero subheadline:**  
Upload leases, extract key terms, track critical dates, onboard tenants, and clear billing blockers — with review-first automation.

**Core product promise:**  
Leasium turns lease documents into controlled workflows.

**Trust line:**  
Nothing is applied until you approve it.

**Brand personality:**  
Calm, precise, modern, operational, trustworthy, automation-first, premium but not cold.

**Avoid:**  
Keys, roofs, generic buildings, legal scales, handshakes, clip-art real estate icons, overhyped AI language, cluttered dashboards, gimmicky gradients.

---

## 2. Chosen logo direction

**Logo concept:** Corner Signal

The selected mark is a rounded blue app tile with a white geometric **L** and a teal signal dot.

Meaning:
- The **L** represents Leasium, leases, structure, and operational control.
- The **teal dot** represents automation, readiness, alerts, and smart review.
- The rounded blue square gives the product a modern SaaS/app identity.

### Logo SVG

Use this as the base app icon/logo mark.

```svg
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Leasium logo">
  <rect x="48" y="48" width="416" height="416" rx="104" fill="#245BFF"/>
  <path d="M180 180V352H316" stroke="#FFFFFF" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="368" cy="160" r="40" fill="#27D8C2"/>
</svg>
```

### React logo component

```tsx
export function LeasiumLogoMark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Leasium logo"
      className={className}
    >
      <rect x="48" y="48" width="416" height="416" rx="104" fill="#245BFF" />
      <path
        d="M180 180V352H316"
        stroke="#FFFFFF"
        strokeWidth="56"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="368" cy="160" r="40" fill="#27D8C2" />
    </svg>
  );
}

export function LeasiumWordmark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div className={className} style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
      <LeasiumLogoMark size={size} />
      <span
        style={{
          fontFamily:
            "Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: Math.round(size * 0.72),
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: "-0.035em",
          color: "#101828",
        }}
      >
        Leasium
      </span>
    </div>
  );
}
```

### Logo usage rules

- Use the mark alone for app icon, favicon, sidebar collapsed state, loading screens, and mobile.
- Use mark + wordmark for marketing pages, login, top nav, and empty states.
- Keep clear space around the logo equal to at least 25% of the tile width.
- Do not add shadows, bevels, outlines, roofs, keys, buildings, or extra dots.
- For very small favicon use, the teal dot may be simplified or removed if it becomes visually noisy.

---

## 3. Colour system

### Core logo colours

```txt
Primary Blue:        #245BFF
Automation Teal:     #27D8C2
White:               #FFFFFF
```

### Brand palette

```txt
Blue:                #245BFF
Blue Hover:          #1E4FE5
Blue Pressed:        #173FC2
Blue Soft:           #EAF0FF

Teal:                #27D8C2
Teal Hover:          #1EBEAB
Teal Soft:           #E8FAF7
```

### Neutral palette

```txt
Navy 900:            #0B1020
Navy 800:            #101828
Slate 700:           #1D2939
Slate 600:           #344054
Slate 500:           #475467
Slate 400:           #667085
Slate 300:           #98A2B3
Slate 200:           #D0D5DD
Slate 150:           #E4E7EC
Slate 100:           #F2F4F7
Slate 50:            #F6F8FB
White:               #FFFFFF
```

### Semantic colours

```txt
Success:             #12B76A
Success Soft:        #ECFDF3

Warning:             #F79009
Warning Soft:        #FFFAEB

Danger:              #F04438
Danger Soft:         #FEF3F2

Info:                #2E90FA
Info Soft:           #EFF8FF
```

### App colour usage

```txt
App Background:      #F6F8FB
Surface:             #FFFFFF
Elevated Surface:    #FFFFFF
Sidebar:             #0B1020
Border:              #E4E7EC
Strong Border:       #D0D5DD
Text Primary:        #101828
Text Secondary:      #475467
Text Muted:          #667085
Text Inverse:        #FFFFFF
Focus Ring:          #245BFF
```

### Colour rules

- Blue is the primary action and brand colour.
- Teal is for automation, readiness, successful intake, and cleared workflow states.
- Amber is for waiting, upcoming, and attention-needed states.
- Red is only for true blockers, overdue risk, destructive actions, or critical compliance problems.
- Do not rely on colour alone. Pair colour with clear labels and, where useful, icons.

---

## 4. Typography

Use **Geist** if available. Fallback to **Inter**, then system sans.

```css
font-family: Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

### Type scale

```txt
Display:
48px / 56px / 700 / -0.04em

H1:
36px / 44px / 700 / -0.035em

H2:
30px / 38px / 700 / -0.03em

H3:
24px / 32px / 650 / -0.02em

Body Large:
18px / 28px / 400

Body:
16px / 24px / 400

Body Small:
14px / 20px / 400

Caption:
12px / 16px / 500 / 0.01em
```

### Typography rules

- Use tight letter spacing on large headings.
- Use medium/semibold only for clear hierarchy.
- Keep dashboard text calm and compact.
- Avoid all-caps except tiny labels or table headers.
- Tables and forms must prioritize readability over visual drama.

---

## 5. Spacing, radius, shadows, motion

### Spacing scale

```txt
1: 4px
2: 8px
3: 12px
4: 16px
5: 20px
6: 24px
8: 32px
10: 40px
12: 48px
16: 64px
```

### Radius

```txt
XS:      6px
SM:      8px
MD:      12px
LG:      16px
XL:      20px
2XL:     24px
Full:    999px
```

### Shadows

```txt
XS: 0 1px 2px rgba(16, 24, 40, 0.05)
SM: 0 1px 3px rgba(16, 24, 40, 0.10), 0 1px 2px rgba(16, 24, 40, 0.06)
MD: 0 8px 24px rgba(16, 24, 40, 0.08)
LG: 0 20px 48px rgba(16, 24, 40, 0.12)
```

### Motion

```txt
Fast:     120ms
Base:     180ms
Slow:     260ms
Easing:   cubic-bezier(0.16, 1, 0.3, 1)
```

Motion should be subtle. Use it for drawer transitions, hover states, upload progress, and panel opening. Respect `prefers-reduced-motion`.

---

## 6. CSS variables

Drop this into the global CSS file.

```css
:root {
  --leasium-blue: #245BFF;
  --leasium-blue-hover: #1E4FE5;
  --leasium-blue-pressed: #173FC2;
  --leasium-blue-soft: #EAF0FF;

  --leasium-teal: #27D8C2;
  --leasium-teal-hover: #1EBEAB;
  --leasium-teal-soft: #E8FAF7;

  --leasium-navy-900: #0B1020;
  --leasium-navy-800: #101828;

  --leasium-slate-700: #1D2939;
  --leasium-slate-600: #344054;
  --leasium-slate-500: #475467;
  --leasium-slate-400: #667085;
  --leasium-slate-300: #98A2B3;
  --leasium-slate-200: #D0D5DD;
  --leasium-slate-150: #E4E7EC;
  --leasium-slate-100: #F2F4F7;
  --leasium-slate-50: #F6F8FB;

  --leasium-bg: #F6F8FB;
  --leasium-surface: #FFFFFF;
  --leasium-border: #E4E7EC;
  --leasium-border-strong: #D0D5DD;

  --leasium-success: #12B76A;
  --leasium-success-soft: #ECFDF3;
  --leasium-warning: #F79009;
  --leasium-warning-soft: #FFFAEB;
  --leasium-danger: #F04438;
  --leasium-danger-soft: #FEF3F2;
  --leasium-info: #2E90FA;
  --leasium-info-soft: #EFF8FF;

  --leasium-text-primary: #101828;
  --leasium-text-secondary: #475467;
  --leasium-text-muted: #667085;
  --leasium-text-inverse: #FFFFFF;

  --leasium-font-sans: Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

  --leasium-radius-xs: 6px;
  --leasium-radius-sm: 8px;
  --leasium-radius-md: 12px;
  --leasium-radius-lg: 16px;
  --leasium-radius-xl: 20px;
  --leasium-radius-2xl: 24px;

  --leasium-shadow-xs: 0 1px 2px rgba(16, 24, 40, 0.05);
  --leasium-shadow-sm: 0 1px 3px rgba(16, 24, 40, 0.10), 0 1px 2px rgba(16, 24, 40, 0.06);
  --leasium-shadow-md: 0 8px 24px rgba(16, 24, 40, 0.08);
  --leasium-shadow-lg: 0 20px 48px rgba(16, 24, 40, 0.12);

  --leasium-ease: cubic-bezier(0.16, 1, 0.3, 1);
}

body {
  background: var(--leasium-bg);
  color: var(--leasium-text-primary);
  font-family: var(--leasium-font-sans);
}

*:focus-visible {
  outline: 2px solid var(--leasium-blue);
  outline-offset: 2px;
}
```

---

## 7. Tailwind theme extension

Drop this into `tailwind.config.ts` under `theme.extend`.

```ts
export const leasiumTheme = {
  colors: {
    leasium: {
      blue: "#245BFF",
      "blue-hover": "#1E4FE5",
      "blue-pressed": "#173FC2",
      "blue-soft": "#EAF0FF",

      teal: "#27D8C2",
      "teal-hover": "#1EBEAB",
      "teal-soft": "#E8FAF7",

      navy: {
        900: "#0B1020",
        800: "#101828",
      },

      slate: {
        700: "#1D2939",
        600: "#344054",
        500: "#475467",
        400: "#667085",
        300: "#98A2B3",
        200: "#D0D5DD",
        150: "#E4E7EC",
        100: "#F2F4F7",
        50: "#F6F8FB",
      },

      bg: "#F6F8FB",
      surface: "#FFFFFF",
      border: "#E4E7EC",
      "border-strong": "#D0D5DD",

      success: "#12B76A",
      "success-soft": "#ECFDF3",
      warning: "#F79009",
      "warning-soft": "#FFFAEB",
      danger: "#F04438",
      "danger-soft": "#FEF3F2",
      info: "#2E90FA",
      "info-soft": "#EFF8FF",
    },
  },

  fontFamily: {
    sans: [
      "Geist",
      "Inter",
      "ui-sans-serif",
      "system-ui",
      "-apple-system",
      "BlinkMacSystemFont",
      "Segoe UI",
      "sans-serif",
    ],
  },

  borderRadius: {
    leasiumXs: "6px",
    leasiumSm: "8px",
    leasiumMd: "12px",
    leasiumLg: "16px",
    leasiumXl: "20px",
    leasium2xl: "24px",
  },

  boxShadow: {
    leasiumXs: "0 1px 2px rgba(16, 24, 40, 0.05)",
    leasiumSm:
      "0 1px 3px rgba(16, 24, 40, 0.10), 0 1px 2px rgba(16, 24, 40, 0.06)",
    leasiumMd: "0 8px 24px rgba(16, 24, 40, 0.08)",
    leasiumLg: "0 20px 48px rgba(16, 24, 40, 0.12)",
  },

  transitionTimingFunction: {
    leasium: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
};
```

---

## 8. Component design system

### App shell

The app should feel like a command centre.

Recommended layout:
- Left sidebar with dark navy background.
- Main content area on soft grey background.
- White cards with subtle borders.
- Top bar with search, workspace name, notifications, and user menu.
- Optional right-side detail panel for selected tenants, leases, documents, or tasks.

Sidebar:
```txt
Background: #0B1020
Active item: soft blue tint or blue left rail
Text: white / muted slate
Logo: mark + Leasium wordmark at top
```

Main area:
```txt
Background: #F6F8FB
Cards: #FFFFFF
Borders: #E4E7EC
```

### Buttons

Primary button:
```txt
Background: #245BFF
Hover: #1E4FE5
Text: white
Height: 44px minimum
Radius: 12px
Font weight: 600
```

Secondary button:
```txt
Background: white
Border: #D0D5DD
Text: #344054
Height: 44px minimum
Radius: 12px
```

Tertiary button:
```txt
Background: transparent
Text: #245BFF or #475467
Use for low-emphasis actions
```

Danger button:
```txt
Background: #F04438
Text: white
Use only for destructive actions
```

Suggested Tailwind primary:
```tsx
className="inline-flex min-h-11 items-center justify-center rounded-leasiumMd bg-leasium-blue px-4 text-sm font-semibold text-white shadow-leasiumXs transition hover:bg-leasium-blue-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leasium-blue"
```

Suggested Tailwind secondary:
```tsx
className="inline-flex min-h-11 items-center justify-center rounded-leasiumMd border border-leasium-border-strong bg-white px-4 text-sm font-semibold text-leasium-slate-600 shadow-leasiumXs transition hover:bg-leasium-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leasium-blue"
```

### Cards

Card style:
```txt
Background: white
Border: 1px solid #E4E7EC
Radius: 16px
Padding: 20–24px
Shadow: XS or none
```

Suggested Tailwind:
```tsx
className="rounded-leasiumLg border border-leasium-border bg-white p-5 shadow-leasiumXs"
```

### Inputs

Input style:
```txt
Height: 44px
Radius: 12px
Border: #D0D5DD
Focused border/ring: #245BFF
Placeholder: #98A2B3
Text: #101828
```

Suggested Tailwind:
```tsx
className="min-h-11 w-full rounded-leasiumMd border border-leasium-border-strong bg-white px-3 text-sm text-leasium-navy-800 placeholder:text-leasium-slate-300 focus:border-leasium-blue focus:outline-none focus:ring-2 focus:ring-leasium-blue/15"
```

### Tables

Tables must support dense lease operations.

Rules:
- Sticky header for long tables.
- Compact row height option.
- Clear status chips.
- Saved views/filters.
- Search and sort.
- Important columns: tenant, property, lease status, next event, billing status, documents, owner, last updated.
- Use right-side detail panel on row click instead of always navigating away.

### Right-side detail panels

Use for:
- Lease details
- Tenant details
- Property details
- Document review
- Billing blocker details
- Task details

Panel layout:
```txt
Header: title, status, close
Summary: key facts
Next action: primary workflow action
Tabs/sections: Overview, Documents, Events, Billing, Activity
Footer: Save, Approve, Apply, Cancel
```

### Modals

Use modals only for:
- Confirm destructive actions
- Small focused forms
- Critical approval confirmation

For complex work, use full page or right-side panel.

---

## 9. Status chips

Use status chips consistently across the product.

```ts
export const leasiumStatusChips = {
  ready: {
    label: "Ready",
    background: "#E8FAF7",
    text: "#107569",
  },
  needsReview: {
    label: "Needs review",
    background: "#EAF0FF",
    text: "#1E4FE5",
  },
  blocked: {
    label: "Blocked",
    background: "#FEF3F2",
    text: "#B42318",
  },
  awaitingTenant: {
    label: "Awaiting tenant",
    background: "#FFFAEB",
    text: "#B54708",
  },
  draft: {
    label: "Draft",
    background: "#F2F4F7",
    text: "#475467",
  },
  synced: {
    label: "Synced",
    background: "#EFF8FF",
    text: "#175CD3",
  },
  overdue: {
    label: "Overdue",
    background: "#FEF3F2",
    text: "#B42318",
  },
  upcoming: {
    label: "Upcoming",
    background: "#FFFAEB",
    text: "#B54708",
  },
  automated: {
    label: "Automated",
    background: "#E8FAF7",
    text: "#107569",
  },
};
```

Chip base style:
```tsx
className="inline-flex min-h-6 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold"
```

---

## 10. UX principles

### Main UX principle

Show the next action, not just the data.

Bad:
```txt
2 blockers
```

Good:
```txt
2 billing blockers
Insurance certificate missing for Acme Retail. Review blocker.
```

Bad:
```txt
No documents
```

Good:
```txt
No documents waiting for review
Drop in a lease, guarantee, insurance certificate, invoice, or tenant document to start your first review.
```

### Product UX principles

1. **Command centre first**  
   The dashboard should tell users what needs attention today.

2. **Review-first automation**  
   AI/intake actions must show extracted values, source references, confidence, and approve/edit/ignore controls.

3. **Exceptions over databases**  
   Prioritize critical dates, blockers, overdue items, missing tenant documents, and billing readiness.

4. **Every empty state should teach**  
   Give demo data, upload prompts, and next actions.

5. **Keep users in flow**  
   Use right-side detail panels instead of unnecessary full page jumps.

6. **Make auditability visible**  
   Show who approved what, when it changed, and what document or clause was the source.

7. **Design for dense operations**  
   Use clean tables, saved filters, sticky columns, compact chips, and fast keyboard search.

8. **Reduce anxiety**  
   Use calm language and restrained colour. Reserve red for true risk.

---

## 10.5 Operational guardrails (drift prevention)

These are not aesthetic principles; they are operational rules that exist
because the implementation has drifted from the spec at least once in the
past. New code MUST follow them. Old code that violates them is evidence
of drift and should be flagged in `docs/design-governance.md` as a follow-up.

If a change needs to violate a guardrail, document the deliberate exception
in the same governance entry. Silent drift is what produced the
`docs/external-design-review-2026-05-23.md` findings — none of this is new
direction, all of it was already in the source of truth, the code just
walked away.

### 10.5.1 Primary navigation cap

- **Hard ceiling: 7 items in the sidebar at any time.** Current shipped
  state is 8 (Dashboard, Smart Intake, Properties, Tenants, Work, Billing,
  Insights, Settings) pending a Properties+Tenants → Portfolio
  consolidation that gets us to 7.
- Anything beyond the ceiling lives in the Cmd-K command palette
  (`commandActions` in `apps/web/src/components/app-shell.tsx`).
- Keyboard `G`-shortcuts (`SHORTCUT_NAV`) MAY exceed the sidebar list —
  muscle memory should be preserved for palette-only destinations.
- New top-level routes do NOT auto-promote to the sidebar; they default
  to palette-only and earn a sidebar slot only when an operator uses
  them daily.

### 10.5.2 Typography ladder enforcement

- **Always use the `PageTitle` and `SectionTitle` components** from
  `apps/web/src/components/ui.tsx`. Never inline
  `<h1 className="text-3xl">` or `<h2 className="text-[15px]">` on a
  workspace page.
- `PageTitle` is `<h1>`, 30/36, tracking-tight. There is exactly one
  PageTitle per route.
- `SectionTitle` is `<h2>`, 18/28, tracking-tight. Every `SectionPanel`
  title uses it. Standalone section headings outside SectionPanel use it.
- Body text uses `text-sm` (14/20) for dense tables and `text-base`
  (16/24) for prose. Don't use `text-xs` (12) for anything other than
  caption-level labels.

### 10.5.3 Page-file size policy

- **Cap each page/component file at ~400 lines.** When a file grows past
  ~250 lines, plan extraction into a co-located subdirectory of named
  section components (e.g. `src/app/<route>/_components/` or
  `src/components/<surface>/`).
- The shape of a file dictates the shape of its UI. Monolithic files
  encourage monolithic UI — every section gets wrapped in the same
  `<SectionPanel>` because importing a second container archetype is
  inconvenient.
- Existing offenders (`dashboard.tsx`, `property-workspace.tsx`,
  `settings/page.tsx`, `operations/page.tsx`) are grandfathered until
  the page-file split slice ships, but no new code should add to them.

### 10.5.4 Container hierarchy

- `<SectionPanel>` is for **aside content**: Ask Leasium, Recent activity,
  evidence/source-trail disclosures, preview/receipt panels, anything
  that supports the main workspace task.
- The **main workspace body** (tables, lists, dense data) renders on the
  page background with `<SectionTitle>` headings and divider rules, no
  card chrome. Today this archetype is implicit (Properties /
  Operations / Billing-readiness use `<SectionPanel>` everywhere); a
  reusable `<Surface>` component is queued in the design review.
- Don't wrap a table in a SectionPanel just because the import is
  already there. Reach for the right container.

### 10.5.5 Status chip vocabulary

- Use only the named chips in §9. Don't invent ad-hoc tone-and-text
  combinations in components.
- New status concepts go through Remba before they enter the codebase.
- `StatusBadge` in `apps/web/src/components/ui.tsx` is the only chip
  primitive; per-domain chips (status, priority, etc.) compose its
  `tone` prop.

### 10.5.6 Dashboard structure

- Order is fixed: **Command center → Smart Intake → Operational metrics
  → Context (lease events / Ask Leasium / Activity feed)**.
- The metric strip carries operational counts only (Operations, Billing
  blockers, Needs review, Blocked docs). Cap at 4. Navigational counts
  (Properties, Tenants) belong in the sidebar, not the metric strip.
- The Smart Intake drop zone MUST sit in the first viewport at common
  laptop sizes (1440px). It is the product wedge.

### 10.5.7 Provider mutation guardrail

- **No Xero write, SendGrid email, Twilio SMS, tenant email, or payment
  reconciliation without explicit operator approval.** Every provider
  call is review-first: extract → confidence → source → approve/edit/
  ignore → only then mutate.
- This applies to every surface, every component, every helper.
- Cross-reference: CLAUDE.md §2.1; design-governance.md across all
  Xero/Comms/Onboarding entries.

### 10.5.8 Remba review gate

Remba is the required UX sign-off for design-facing changes. Treat the
following as Remba-pending by default:

- navigation (sidebar items, breadcrumbs, route restructure)
- page layout (column counts, panel ordering, section hierarchy)
- density (table row heights, padding, gap values)
- typography (size, weight, tracking — even when using the existing
  ladder, applying it to a new surface counts)
- copy (page titles, descriptions, empty states, error messages,
  CTAs, microcopy)
- status semantics (new chips, tone changes, recovery flows)
- workflow ordering (what happens before what, default selections,
  required vs optional)
- visual hierarchy (what draws the eye first; the order of weight in
  a section)
- design system primitives (new components in `ui.tsx`, token changes,
  shadow/radius/spacing additions)

Process for design-facing changes:

1. Ship behind a `pending Remba review` note in
   `docs/design-governance.md` (add a numbered follow-up entry under
   the relevant heading).
2. Mark the corresponding roadmap item as `[~]` in
   `docs/product-roadmap.md`. Not `[x]`. `[x]` is only after Remba signs
   off.
3. State the Remba decision request explicitly in the governance entry
   — what should Remba review, what alternatives were considered, what
   tradeoff is on the table.
4. Don't claim "complete" before Remba sign-off, even if all tests pass.

The point of the gate is not bureaucracy. It is to keep the spec and
the implementation aligned, so a future external review doesn't find
the same drift twice.

### 10.5.9 Drift detection

- If code violates one of these guardrails, it is evidence of drift.
  Restore the rule, or document the deliberate exception in the
  governance log.
- When a session like the 2026-05-23 external review surfaces drift,
  the response is not "rewrite the world" — it is to (a) update this
  document so the rule is named, (b) ship the highest-leverage fixes,
  and (c) queue the rest as `pending Remba review` follow-ups.
- The single most useful question when reviewing a diff is: "Does this
  match how the existing system was supposed to work, or does it match
  how the existing code happens to work today?" The first answer is
  the right one.

---

## 11. Navigation model

Use this primary navigation:

```txt
Dashboard
Lease Inbox
Properties
Tenants
Tasks
Billing Readiness
Reports
Settings
```

### Navigation notes

- **Lease Inbox** should be a major item, not hidden, because Smart Intake is the product wedge.
- **Billing Readiness** should be clear because billing blockers are a high-value workflow.
- **Tasks** should aggregate lease events, onboarding work, review items, and operational follow-up.
- Use global search / command palette with `Cmd+K` or `Ctrl+K`.

### Command palette actions

```txt
Search tenant
Search property
Upload lease
Upload document
Add critical date
Create charge rule
View billing blockers
Invite tenant
Create task
Open Lease Inbox
Open onboarding queue
```

---

## 12. Dashboard design

The dashboard should be an exception-focused command centre, not a static stats page.

Recommended dashboard sections:

```txt
Today in lease operations
Critical attention
Smart intake queue
Billing readiness
Upcoming lease events
Tenant onboarding pipeline
Recent automation activity
```

### Dashboard card examples

Attention card:
```txt
Critical attention
3 items need review

- Insurance certificate missing for Acme Retail
- Rent review due in 14 days for Northside Pharmacy
- Lease extraction waiting for approval: Suite 4B
```

Smart intake card:
```txt
Smart intake queue
2 documents ready for review

- New lease: Acme Retail — 8 extracted terms
- Insurance certificate: Northside Pharmacy — expiry date detected

Nothing is applied until you approve it.
```

Billing readiness card:
```txt
Billing readiness
92% ready for next invoice run

2 blockers:
- Missing charge rule for Suite 4B
- Xero contact not mapped for Urban Dental
```

Upcoming events card:
```txt
Upcoming lease events
5 events in the next 30 days

- Rent review — Acme Retail — 14 days
- Option notice window opens — Urban Dental — 21 days
- Insurance expiry — Northside Pharmacy — 28 days
```

### Empty dashboard state

If no data exists, show a helpful setup panel:

```txt
Set up your first lease workflow

Upload a lease or load a demo portfolio to see how Leasium tracks key dates, documents, onboarding, and billing readiness.

Primary: Upload lease
Secondary: View demo portfolio
```

---

## 13. Smart Intake UX

Smart Intake is the hero workflow.

### Flow

```txt
Upload document
Extract key terms
Review confidence
Approve or edit
Apply to lease workflow
Generate tasks and reminders
```

### Recommended layout

```txt
Left panel:
Document preview

Right panel:
Extracted fields and review controls

Bottom action bar:
Approve selected
Apply to lease
Save draft
Cancel
```

### Extracted field card

Each extracted field must show:

```txt
Field label
Extracted value
Confidence
Source clause/page
Approve / Edit / Ignore
```

Example:
```txt
Lease commencement date
1 July 2026
Confidence: High
Source: Page 3, clause 2.1
Actions: Approve | Edit | Ignore
```

### Trust language

Use this line near review actions:
```txt
Nothing is applied until you approve it.
```

### Confidence design

```txt
High confidence:
Teal / Ready

Medium confidence:
Amber / Review recommended

Low confidence:
Red or amber / Needs review
```

Never auto-apply low-confidence extracted fields.

---

## 14. Lease Inbox

Lease Inbox should be the place where documents become workflows.

Recommended filters:
```txt
All
Needs review
Ready to apply
Applied
Draft
Low confidence
Blocked
```

Recommended item data:
```txt
Document name
Document type
Related property
Related tenant
Extracted fields count
Confidence summary
Uploaded by
Uploaded date
Status
Next action
```

Recommended row action:
```txt
Review document
```

Empty state:
```txt
No documents waiting for review

Drop in a lease, guarantee, insurance certificate, invoice, or tenant document to start your first review.

Primary: Upload document
Secondary: View demo portfolio
```

---

## 15. Properties UX

Property pages should show lease and operational readiness.

Suggested sections:
```txt
Property summary
Active tenancies
Lease events
Billing readiness
Documents
Charge rules
Xero/accounting mapping
Activity
```

Key property metrics:
```txt
Active tenants
Upcoming lease events
Billing blockers
Documents needing review
Onboarding status
```

Property card example:
```txt
Queen Street Retail Centre
8 active tenancies
2 upcoming rent reviews
1 billing blocker
93% billing ready
```

---

## 16. Tenants UX

Tenant pages should show onboarding, lease status, documents, and billing readiness.

Suggested sections:
```txt
Tenant summary
Lease details
Onboarding checklist
Documents
Billing readiness
Key dates
Tasks
Activity
```

Tenant onboarding pipeline:
```txt
Not started
Invite sent
Tenant submitted
Internal review
Complete
```

Tenant card example:
```txt
Acme Retail
Lease active
Onboarding: Awaiting insurance certificate
Next event: Rent review in 14 days
Billing: Ready
```

---

## 17. Billing Readiness UX

Billing Readiness should answer:

```txt
Can we invoice correctly?
What is blocking the invoice run?
Who needs to fix it?
What changed since last run?
```

Recommended sections:
```txt
Readiness score
Blockers
Warnings
Ready tenancies
Accounting mappings
Charge rules
Recent billing updates
```

Blocker example:
```txt
Blocked
Xero contact not mapped
Tenant: Urban Dental
Impact: Cannot sync invoice
Action: Map Xero contact
```

Readiness score:
```txt
92% ready
23 of 25 active tenancies are ready for billing
2 blockers need review before the next invoice run
```

---

## 18. Tasks UX

Tasks should aggregate the operational work created by leases, documents, onboarding, and billing.

Task statuses:
```txt
Open
In progress
Waiting
Done
Overdue
```

Task sources:
```txt
Lease event
Smart intake
Tenant onboarding
Billing blocker
Manual task
System reminder
```

Task card example:
```txt
Review rent review clause
Acme Retail
Due in 5 days
Source: Lease event
Action: Review clause
```

---

## 19. Empty states

Every empty state should have:
- Clear title
- Short explanation
- Primary action
- Optional secondary action
- Optional link to demo data

Examples:

```txt
No tenants yet
Add your first tenant or load a demo portfolio to see tenant onboarding, lease dates, and billing readiness in action.

Primary: Add tenant
Secondary: View demo portfolio
```

```txt
No billing blockers
Everything is ready for the next invoice run.

Primary: View billing readiness
```

```txt
No lease events
Upload a lease or add a key date to start tracking critical obligations.

Primary: Upload lease
Secondary: Add key date
```

---

## 20. Demo data mode

Add a `View demo portfolio` action for empty states and early product demos.

Demo portfolio example:

```txt
Queen Street Retail Centre
8 active tenants
2 upcoming rent reviews
1 insurance certificate overdue
1 lease awaiting approval
2 billing blockers before invoice run
```

Demo tenants:
```txt
Acme Retail
Northside Pharmacy
Urban Dental
Harbour Fitness
Bright Coffee Co.
```

Demo workflows:
```txt
Lease awaiting review
Insurance certificate overdue
Rent review due in 14 days
Xero contact mapping missing
Tenant onboarding waiting on documents
```

This makes the product value visible before the user has created real data.

---

## 21. Website / landing page design

The marketing site should sell outcomes, not just features.

### Landing page structure

```txt
Hero
Problem
Product workflow
Smart Intake
Command centre dashboard
Tenant onboarding
Billing readiness
Trust and auditability
Pricing
Final CTA
```

### Hero copy

```txt
Run every lease from one command centre.

Upload leases, extract key terms, track critical dates, onboard tenants, and clear billing blockers — with review-first automation.

Primary CTA: Book a demo
Secondary CTA: View product tour
```

### Problem section

```txt
Lease admin is scattered across inboxes, spreadsheets, PDFs, calendars, and accounting systems.

Leasium brings every lease, tenant, document, date, and billing blocker into one controlled workflow.
```

### Workflow section

```txt
Upload. Review. Automate.

1. Upload lease or tenant document
2. Review extracted terms
3. Approve key dates and obligations
4. Let Leasium track reminders, onboarding, and billing readiness
```

### Trust section

```txt
Review-first automation
Source-linked lease extraction
Audit trail
Approval history
Role-based workflows
Nothing is applied until you approve it
```

### Visual style

- Use the blue/teal logo palette.
- Use soft backgrounds and white cards.
- Use product screenshots or product-like dashboard mockups.
- Avoid stock photos unless very subtle.
- Use direct copy and clear workflow diagrams.

---

## 22. Pricing page design direction

Pricing should feel transparent, disruptive, and simple.

Recommended headline:
```txt
Simple pricing for serious lease operations.
```

Subheadline:
```txt
No seat fees. Unlimited users. Archived leases are free. No quote required under 250 active tenancies.
```

Core pricing principles:
```txt
Charge by active tenancy, not users.
Unlimited users on every paid plan.
Archived leases are free.
Use annual pricing as the main displayed option.
Offer a switcher incentive for customers leaving expensive platforms.
```

Recommended public plans:
```txt
Lease Check — Free
Launch — $149/mo or $1,490/yr
Growth — $399/mo or $3,990/yr
Portfolio — $599/mo or $5,990/yr
Enterprise — From $999/mo
```

Pricing page card style:
- White cards.
- Portfolio or Growth can be visually highlighted.
- Use a blue border and “Most popular” chip for Growth.
- Use clear included limits.
- Keep the comparison simple.

Suggested pricing promise block:
```txt
Transparent pricing.
Unlimited users.
Review-first automation.
No quote required under 250 active tenancies.
```

---

## 23. Copywriting system

### Use these phrases

```txt
Ready for review
Nothing is applied until you approve it
Billing is blocked by missing items
Lease events prepared
Tenant onboarding waiting on documents
Upload. Review. Automate.
Every lease, under control
Run every lease from one command centre
Lease operations, automated
```

### Avoid these phrases

```txt
Revolutionary AI
Game-changing platform
Disruptive ecosystem
Magic automation
Legacy-killing technology
World-class synergy
Generic all-in-one property platform
```

### Tone rules

- Be specific.
- Show the workflow outcome.
- Avoid hype.
- Use calm operational language.
- Do not overpromise AI.
- Use “review-first automation” instead of “AI does everything.”

---

## 24. Accessibility

- Meet WCAG AA contrast.
- Minimum clickable/tappable target: 44px.
- Every interactive element needs a visible focus state.
- Never rely on colour alone for status.
- Forms need labels, helper text, validation states, and error messages.
- Tables need keyboard-friendly navigation.
- Respect `prefers-reduced-motion`.
- Use semantic HTML for headings, buttons, navigation, and regions.

---

## 25. Implementation checklist for Codex

Apply this order:

1. Add logo component using the SVG in this file.
2. Add global CSS variables.
3. Add Tailwind theme extension.
4. Update app shell with Leasium brand colours.
5. Update sidebar and navigation.
6. Add `Lease Inbox` to main navigation.
7. Standardize cards, buttons, inputs, status chips, and tables.
8. Upgrade the dashboard into an exception-first command centre.
9. Improve empty states with useful next actions and demo-data prompts.
10. Make Smart Intake the hero workflow.
11. Add review-first intake UI with confidence and source references.
12. Add right-side detail panels.
13. Add Command-K / Ctrl-K command palette.
14. Add consistent copy and trust language.
15. Apply accessibility rules across the app.

---

## 26. Design token JSON

```json
{
  "brand": {
    "name": "Leasium",
    "tagline": "Lease operations, automated.",
    "heroHeadline": "Run every lease from one command centre.",
    "heroSubheadline": "Upload leases, extract key terms, track critical dates, onboard tenants, and clear billing blockers — with review-first automation.",
    "positioning": "A modern lease operations command centre that turns lease documents, tenant onboarding, billing readiness, attention items, and critical dates into review-first automated workflows.",
    "trustLine": "Nothing is applied until you approve it."
  },
  "logo": {
    "concept": "Corner Signal",
    "blue": "#245BFF",
    "teal": "#27D8C2",
    "white": "#FFFFFF"
  },
  "colors": {
    "blue": "#245BFF",
    "blueHover": "#1E4FE5",
    "bluePressed": "#173FC2",
    "blueSoft": "#EAF0FF",
    "teal": "#27D8C2",
    "tealHover": "#1EBEAB",
    "tealSoft": "#E8FAF7",
    "navy900": "#0B1020",
    "navy800": "#101828",
    "slate700": "#1D2939",
    "slate600": "#344054",
    "slate500": "#475467",
    "slate400": "#667085",
    "slate300": "#98A2B3",
    "slate200": "#D0D5DD",
    "slate150": "#E4E7EC",
    "slate100": "#F2F4F7",
    "slate50": "#F6F8FB",
    "surface": "#FFFFFF",
    "success": "#12B76A",
    "successSoft": "#ECFDF3",
    "warning": "#F79009",
    "warningSoft": "#FFFAEB",
    "danger": "#F04438",
    "dangerSoft": "#FEF3F2",
    "info": "#2E90FA",
    "infoSoft": "#EFF8FF"
  },
  "typography": {
    "fontSans": "Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "display": { "size": "48px", "lineHeight": "56px", "weight": 700, "letterSpacing": "-0.04em" },
    "h1": { "size": "36px", "lineHeight": "44px", "weight": 700, "letterSpacing": "-0.035em" },
    "h2": { "size": "30px", "lineHeight": "38px", "weight": 700, "letterSpacing": "-0.03em" },
    "h3": { "size": "24px", "lineHeight": "32px", "weight": 650, "letterSpacing": "-0.02em" },
    "body": { "size": "16px", "lineHeight": "24px", "weight": 400 },
    "small": { "size": "14px", "lineHeight": "20px", "weight": 400 },
    "caption": { "size": "12px", "lineHeight": "16px", "weight": 500 }
  },
  "radius": {
    "xs": "6px",
    "sm": "8px",
    "md": "12px",
    "lg": "16px",
    "xl": "20px",
    "2xl": "24px",
    "full": "999px"
  },
  "navigation": [
    "Dashboard",
    "Lease Inbox",
    "Properties",
    "Tenants",
    "Tasks",
    "Billing Readiness",
    "Reports",
    "Settings"
  ],
  "statusChips": {
    "ready": { "label": "Ready", "background": "#E8FAF7", "text": "#107569" },
    "needsReview": { "label": "Needs review", "background": "#EAF0FF", "text": "#1E4FE5" },
    "blocked": { "label": "Blocked", "background": "#FEF3F2", "text": "#B42318" },
    "awaitingTenant": { "label": "Awaiting tenant", "background": "#FFFAEB", "text": "#B54708" },
    "draft": { "label": "Draft", "background": "#F2F4F7", "text": "#475467" },
    "synced": { "label": "Synced", "background": "#EFF8FF", "text": "#175CD3" },
    "overdue": { "label": "Overdue", "background": "#FEF3F2", "text": "#B42318" },
    "automated": { "label": "Automated", "background": "#E8FAF7", "text": "#107569" }
  }
}
```

---

## 27. Final Codex instruction

When implementing Leasium, use this file as the source of truth. Prioritize a premium SaaS experience that feels calm, clear, and operational. The UI should help users answer four questions quickly:

```txt
What needs attention?
What is blocked?
What is ready?
What can be automated after review?
```

The product should always feel like:

```txt
Upload.
Review.
Approve.
Automate.
```
