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

### Owner tag palette

Owner/billing identity chips need more distinguishable hues than the
four semantic colours allow. The palette below is a soft pastel ramp
where each entry has a paired border, background, and text colour
pre-balanced for WCAG AA contrast at chip-text sizes. Assign by
deterministic hash of the owner label so a given owner shows the same
tag across surfaces. Slate is reserved for the "current entity / no
distinct owner" baseline.

```txt
                     Border    Background  Text
Current (blue):      #BFDBFE   #EFF6FF     #1D4ED8
Sky:                 #BAE6FD   #F0F9FF     #0369A1
Teal:                #99F6E4   #F0FDFA     #0F766E
Cyan:                #A5F3FC   #ECFEFF     #0E7490
Lavender:            #DDD6FE   #F5F3FF     #5B21B6
Indigo:              #C7D2FE   #EEF2FF     #3730A3
Green:               #BBF7D0   #F0FDF4     #15803D
Lime:                #D9F99D   #F7FEE7     #4D7C0F
Amber:               #FDE68A   #FFFBEB     #B45309
Rose:                #FECDD3   #FFF1F2     #BE123C
Pink:                #FBCFE8   #FDF2F8     #BE185D
Peach:               #FED7AA   #FFF7ED     #C2410C
Slate (baseline):    slate-200 slate-100   slate-600
```

Use these only for owner / billing identity chips on property and
settings surfaces. Do not reuse this palette for status pills or
semantic states — those must come from §3 Semantic colours so that
status meaning stays orthogonal to owner identity.

### App colour usage

```txt
App Background:      #F7F9FC
Surface:             #FFFFFF
Elevated Surface:    #FFFFFF
Sidebar:             #0B1020
Border:              #E7EBF0
Strong Border:       #D0D5DD
Text Primary:        #101828
Text Secondary:      #475467
Text Muted:          #475467
Text Inverse:        #FFFFFF
Focus Ring:          #245BFF
```

### Horizon additions

Approved 2026-06-10 in Figma and used for Dashboard/Work uplifts.

```txt
Canvas:              #F7F9FC
Card Border:         #E7EBF0
Hero Wash:           #EAF0FF -> #E8FAF7
Primary CTA Glow:    0 4px 12px rgba(36, 91, 255, 0.30-0.35)
Card Shadow:         0 1px 3px rgba(16, 24, 40, 0.04)
```

Horizon bento cards use equal-height rows, 14px gutters, 18px card
radius, and 20px hero radius. A screen should have one primary CTA:
the focus action. Other controls are secondary buttons or text links.
The review-first trust ribbon appears once per screen after the primary
content, centered in a teal pill.

Implementation tokens: `--leasium-card-border`,
`--leasium-hero-wash-from`, `--leasium-hero-wash-to`, and
`--leasium-teal-strong` back the Horizon-specific utilities. These must stay
CSS-variable based so the same component classes remap in dark mode.

### Dark mode tokens

Dark mode is an operator-workspace theme, not a separate brand. It uses
the same semantic names as light mode so components stay on shared
tokens. The app applies both `.dark` and `data-theme="dark"` on the root
element; current CSS selectors key from `data-theme` while the `.dark`
class keeps Tailwind `dark:` variants available for new code.

```txt
Blue:                #8EA5FF
Blue Hover:          #B7C5FF
Blue Pressed:        #D8E0FF
Blue Soft:           #182554

Teal:                #42E3CF
Teal Hover:          #84F0E3
Teal Soft:           #0F3A37
Teal Strong:         #84F0E3

Navy 900:            #050814
Navy 800:            #E6EAF3
Slate 700:           #D7DEEA
Slate 600:           #C3CCDB
Slate 500:           #AAB5C8
Slate 400:           #8F9BAD
Slate 300:           #68758A
Slate 200:           #344054
Slate 150:           #243044
Slate 100:           #182133
Slate 50:            #0D1424

App Background:      #0D1424
Surface:             #121A2A
Border:              #263247
Strong Border:       #3A465B
Horizon Card Border: #263247
Horizon Hero Wash:   #111B35 -> #102B2A

Success:             #32D583
Success Soft:        #0F2F24
Warning:             #FDB022
Warning Soft:        #342610
Danger:              #F97066
Danger Soft:         #351716
Info:                #84CAFF
Info Soft:           #102A43
```

Dark-mode mapping notes:

- `-strong` text tokens (`text-success-strong`, `text-warning-strong`,
  `text-danger-strong`) map to the base state colour in dark. The
  `-strong` shades are darkened for light soft fills; on the dark soft
  fills the base state colour is the readable one.
- Neutral chip text resolves to dark Slate 500 (`#AAB5C8`) on the dark
  muted fill (Slate 100, `#182133`). The light value (`#475467`) reads
  at roughly 2.2:1 on that fill and fails AA — never pin it on a
  dark-reachable surface.
- Owner-tag chips (§3) are a known limitation in dark: the palette is
  pre-balanced for light backgrounds only and currently renders
  unthemed. Acceptable while dark mode is operator-internal; a dark
  owner-tag ramp needs its own balancing pass.
- Map tiles stay light in dark mode: light tiles in a contained rounded
  frame for v1, rather than a custom dark tile set.

### Colour rules

- Blue is the primary action and brand colour.
- Teal is for automation, readiness, successful intake, and cleared workflow states.
- Amber is for waiting, upcoming, and attention-needed states.
- Red is only for true blockers, overdue risk, destructive actions, or critical compliance problems.
- Do not rely on colour alone. Pair colour with clear labels and, where useful, icons.

### Token naming convention (two tier)

Stewart exposes colour tokens in two naming layers; they are not
alternatives — each serves a different role.

**Tier 1 — short semantic aliases.** The public API for the most common
cases. Names: `primary`, `primary-foreground`, `primary-hover`,
`primary-pressed`, `primary-soft`, `accent`, `accent-soft`, `success`,
`success-soft`, `success-strong`, `warning`, `warning-soft`,
`warning-strong`, `danger`, `danger-soft`, `danger-strong`, `info`,
`info-soft`, `background`, `foreground`, `muted`, `muted-foreground`,
`border`, `border-strong`. Use `bg-primary`, `text-success`,
`hover:bg-primary-hover`, etc. Reach for these first.

**Tier 2 — `leasium-*` explicit shades.** For specific shades that
short aliases don't cover, plus the navy/slate ramp and brand-specific
namespaces (`leasium-ownertag-*`, `leasium-micro` text size,
`leasium-body-compact`). Names: `leasium-navy-{900,800}`,
`leasium-slate-{50,100,150,200,300,400,500,600,700}`,
`leasium-teal-hover`, plus the owner-tag palette and typography tokens.
Use when Tier 1 doesn't have what you need — never as a duplicate of
something Tier 1 already covers.

CSS variables follow the Tier 2 convention (`--leasium-*`) regardless
of Tailwind alias availability — they are the canonical Codex SoT
reference for non-Tailwind contexts (inline styles, SVG attrs,
third-party embeds). Do not rename CSS variables to match Tier 1.

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

Body Compact:
15px / 20px / 500

Body Small:
14px / 20px / 400

Caption:
12px / 16px / 500 / 0.01em

Micro:
11px / 14px / 600 / 0.01em
```

### Typography rules

- Use tight letter spacing on large headings.
- Use medium/semibold only for clear hierarchy.
- Keep dashboard text calm and compact.
- Avoid all-caps except tiny labels or table headers.
- Tables and forms must prioritize readability over visual drama.
- Body Compact (15px / 20px / 500) is the dashboard list-row hierarchy: command-center rows, Ask Leasium panel titles, and similar quieter-than-Body but heavier-than-Body-Small contexts. Use when 16px feels chunky and 14px feels weak.
- Micro is reserved for chip text, kbd hints, status pills, and table-row metadata. Never use it for primary content.
- Tabular columns must use `font-variant-numeric: tabular-nums` so digits align — apply via the `tabular-nums` Tailwind utility on numeric `<td>` cells.

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
Fast:     150ms
Base:     200ms
Slow:     300ms

Easings:
  Enter (default):  cubic-bezier(0.16, 1, 0.3, 1)   /* ease-out */
  Exit:             cubic-bezier(0.7,  0, 0.84, 0)  /* ease-in */
  Toggle:           cubic-bezier(0.65, 0, 0.35, 1)  /* ease-in-out */
```

The duration scale aligns with Tailwind's stock `duration-150/-200/-300`
so the existing 80 `duration-200` callers continue to read as Codex
Base without a token migration. Use Base for most transitions, Fast
for button press / toggle ticks / colour shifts, Slow for drawer,
modal, page reveal, and accordion enters.

Easings are paired with direction. Enter (the default `ease-leasium`)
slows into place — use it for elements arriving on screen and for
state toggles where direction is ambiguous. Exit (`ease-leasiumIn`)
accelerates away — use it for elements leaving. Toggle
(`ease-leasiumToggle`) is symmetric — use it for state changes that
don't have a clear enter/exit semantic (e.g. expand/collapse).

Animate only `transform` and `opacity` (GPU-composited; no layout
trigger). Exit durations should be ~75% of the enter duration when
both sides of a transition are visible.

Respect `prefers-reduced-motion`. `globals.css` already collapses
all motion to 0.01ms under that preference; per-component animations
can still opt out via `motion-safe:` Tailwind variants if a critical
UI cue would be lost without motion.

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
  --leasium-slate-100: #E9EDF3;
  --leasium-slate-50: #F6F8FB;

  --leasium-bg: #EDF0F6;
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
  --leasium-text-muted: #475467;
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

:root[data-theme="dark"] {
  --leasium-blue: #8EA5FF;
  --leasium-blue-hover: #B7C5FF;
  --leasium-blue-pressed: #D8E0FF;
  --leasium-blue-soft: #182554;

  --leasium-teal: #42E3CF;
  --leasium-teal-hover: #84F0E3;
  --leasium-teal-soft: #0F3A37;

  --leasium-navy-900: #050814;
  --leasium-navy-800: #E6EAF3;

  --leasium-slate-700: #D7DEEA;
  --leasium-slate-600: #C3CCDB;
  --leasium-slate-500: #AAB5C8;
  --leasium-slate-400: #8F9BAD;
  --leasium-slate-300: #68758A;
  --leasium-slate-200: #344054;
  --leasium-slate-150: #243044;
  --leasium-slate-100: #182133;
  --leasium-slate-50: #0D1424;

  --leasium-bg: #0D1424;
  --leasium-surface: #121A2A;
  --leasium-border: #263247;
  --leasium-border-strong: #3A465B;

  --leasium-success: #32D583;
  --leasium-success-soft: #0F2F24;
  --leasium-warning: #FDB022;
  --leasium-warning-soft: #342610;
  --leasium-danger: #F97066;
  --leasium-danger-soft: #351716;
  --leasium-info: #84CAFF;
  --leasium-info-soft: #102A43;
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

  fontSize: {
    "leasium-body-compact": ["15px", { lineHeight: "20px", fontWeight: "500" }],
    "leasium-micro": ["11px", { lineHeight: "14px", fontWeight: "600", letterSpacing: "0.01em" }],
  },

  boxShadow: {
    leasiumXs: "0 1px 2px rgba(16, 24, 40, 0.05)",
    leasiumSm:
      "0 1px 3px rgba(16, 24, 40, 0.10), 0 1px 2px rgba(16, 24, 40, 0.06)",
    leasiumMd: "0 8px 24px rgba(16, 24, 40, 0.08)",
    leasiumLg: "0 20px 48px rgba(16, 24, 40, 0.12)",
  },

  transitionDuration: {
    leasiumFast: "150ms",
    leasiumBase: "200ms",
    leasiumSlow: "300ms",
  },

  transitionTimingFunction: {
    // leasium is the default ease (Enter / ease-out) used by every
    // existing transition; keep the short name as the public API.
    leasium: "cubic-bezier(0.16, 1, 0.3, 1)",
    leasiumIn: "cubic-bezier(0.7, 0, 0.84, 0)",
    leasiumToggle: "cubic-bezier(0.65, 0, 0.35, 1)",
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

### Empty states

Use `EmptyState` from `apps/web/src/components/ui.tsx` for every empty
section. Required props: `title`. Optional: `description`, `action`,
`icon`.

The `icon` prop is opt-in but recommended for any empty state above
the fold. Pass a lucide-react icon at `size={18}`. The component
renders it as a 36×36 `rounded-leasiumLg` chip with `bg-primary-soft`
and `text-primary`, centred above the title — a single small visual
anchor that turns a centred text block into a piece of layout.

Icon choices follow semantic mapping:

| Empty state semantics | Icon |
| --- | --- |
| Positive empty (nothing wrong) — "No urgent dates", "No blockers", "No exceptions" | `CheckCircle2` |
| Time / upcoming — "No upcoming events", "No lease events" | `Clock3` |
| Activity feed empty | `Activity` |
| Entity / selection prompt | `Building2` |
| Insights / metrics | `Gauge` |
| Notifications / messages | `Bell` or `MailCheck` |
| Error state | `AlertTriangle` |

Title uses `text-leasium-body-compact` (15px / 20px / 500); description
uses `text-sm text-muted-foreground`. Container is `max-w-md` so
descriptions don't span too wide.

Anti-patterns:
- Generic illustrations or stock graphics. The Codex Corner Signal
  motif is the brand logo and stays as the logo only.
- Decorative emoji or "AI sparkle" icons.
- Purple gradients, animated icons, or any motion in an empty state.
- More than one icon per empty state.

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

### Chip system

Use `chipClass()` from `apps/web/src/components/ui.tsx` (or its JSX
wrapper `StatusBadge`) for every chip/pill/badge in the product. Two
density variants and a bordered modifier cover every observed pattern:

| Density | Sizing | Use for |
| --- | --- | --- |
| `default` | `min-h-6 px-2 py-1 text-xs leading-none` | Top-of-card status badges, in-line content chips, hero pills. |
| `compact` | `min-h-5 px-2 py-0.5 text-leasium-micro leading-4` | Table-row chips, status pills inside dense lists, evidence/receipt metadata. |

Tones are the five `StatusTone` values from `components/ui.tsx`:
`neutral`, `success`, `warning`, `danger`, `primary`. Each tone has a
"soft" variant (no border) and a "bordered" variant (tone-coloured
border + soft fill). Use bordered for dense list rows where the chip
needs more definition against the row background; use the soft default
elsewhere.

Examples:

```tsx
import { StatusBadge, chipClass } from "@/components/ui";

// JSX wrapper - default density, neutral tone.
<StatusBadge tone="success">Ready</StatusBadge>

// className helper for non-JSX call sites (e.g. lib helpers that
// return class strings, or one-off inline elements).
<span className={chipClass("warning", { density: "compact", bordered: true })}>
  Partial · 3/5
</span>
```

Never declare new ad-hoc chip class strings (`rounded-full border ...
bg-X-soft text-X-strong`). Add a new tone to `chipClass` if a fresh
semantic is needed; otherwise pick the closest existing tone.

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

- **Hard ceiling: 7 primary items in the sidebar at any time, plus
  Settings.** Current shipped state is 7 primary hubs (Dashboard,
  Smart Intake, Properties, People, Work, Money, Insights) with Settings
  separated as the utility destination. The 2026-05-31 DoorLoop-informed
  consolidation introduced a **People** hub (Tenants · Owners · Vendors ·
  later Prospects) and a **Money** hub (Billing · Statements · Xero · Basiq)
  — see §11 and the `product-roadmap.md` DoorLoop refocus. This supersedes
  the earlier Properties+Tenants → Portfolio idea.
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

Two container archetypes in `apps/web/src/components/ui.tsx`:

- **`<SectionPanel>`** — white card with border, radius, and shadow.
  Use for **aside content**: Ask Leasium, Recent activity, evidence/
  source-trail disclosures, preview/receipt panels, anything that
  supports the main workspace task. Card chrome signals "this is one
  unit of supporting content distinct from the page."

- **`<Surface>`** — no card chrome. Heading + optional description +
  optional actions, divider rule, children render directly on the
  page background. Use for the **main workspace body**: tables, lists,
  dense data, anything that's the main subject of the page. Multiple
  Surfaces stacked make the page feel like one continuous canvas
  with headings.

- A list of cards (one card per item, e.g. owner statements, contractor
  directory rows) is a different pattern again — each item is a small
  SectionPanel, but the *list of them* is not wrapped in an outer
  container. Wrapping per-item-card lists in a `<Surface title="Owners">`
  is fine when the page has multiple such lists side by side; redundant
  when the list is the whole page body.

- Don't wrap a table in a SectionPanel just because the import is
  already there. Reach for the right container. The visual question to
  ask: "Is this content an *aside* to the page's main task, or *is*
  the page's main task?"

Adoption note: `<Surface>` is the new addition (2026-05-23). Existing
workspace pages largely use `<SectionPanel>` everywhere; retrofitting
those is queued behind the page-file split. New surfaces should default
to `<Surface>` for body content from now on.

### 10.5.4a Sidebar breakpoints

The fixed sidebar has three states by viewport:

- **sub-md (<768px)**: sidebar hidden, hamburger button in the header
  opens a full-width drawer overlay. Drawer carries the full sidebar
  content (mark + wordmark + labels). A compact bottom nav is fixed to
  the viewport for the five field-operator hubs: Dashboard, Properties,
  People, Work, and Money. The body reserves a bottom safe-area gutter
  while the operator shell is mounted.
- **md (768–1023px)**: fixed sidebar at 64px, icon-only. No labels
  or shortcuts text; the Work nav may carry a compact comms-count
  badge when the queue has drafts. `title` / accessible labels on each
  nav link provide the module name, and Work includes the comms count
  when present, so the compact rail stays discoverable.
  Body padding-left is 64px.
- **lg+ (≥1024px)**: fixed sidebar at 240px, full content. Body
  padding-left is 240px.

The active-nav state at md drops the 2px left rail (which would
clash with a 64px-wide square row); the bg-white/[0.12] surface
tone alone carries the selected-row signal at icon-only width.

A bottom-nav for the most-used five destinations at sub-md was
shipped pending Remba/real-device review in the 2026-06-01 mobile
operator shell slice. Keep it to five items; secondary destinations stay
in the hamburger drawer, command palette, and G-shortcuts.

### 10.5.5 Status chip vocabulary

- Use only the named chips in §9. Don't invent ad-hoc tone-and-text
  combinations in components.
- New status concepts go through Remba before they enter the codebase.
- `StatusBadge` in `apps/web/src/components/ui.tsx` is the only chip
  primitive; per-domain chips (status, priority, etc.) compose its
  `tone` prop.
- Chip text colors use named tokens (`leasium-success-strong`,
  `leasium-warning-strong`, `leasium-danger-strong`). Don't reach for
  hex literals like `text-[#027A48]` — those bypass the design system
  and resist future palette changes.

### 10.5.5a Loading-state pattern

- The canonical loader for list/table surfaces is `SkeletonRows` in
  `apps/web/src/components/ui.tsx`. Pulse-animated rows mimicking the
  eventual content shape, separated by `divide-y` like real rows.
- Do not use `<EmptyState title="Loading X." />` as a loader. Empty
  states describe absence; skeletons describe wait. The "thin centered
  Loading text in an otherwise empty card" pattern was flagged in the
  2026-05-20 governance note and 2026-05-23 review §1.5.
- Do not use bare `"..."` strings as inline loaders for counts. Show
  the last-known value with a small "Refreshing" badge if revalidating,
  or a skeleton bar at the same size if there's no prior value.
- Acceptable existing pattern for structured page-level loaders is the
  loading-`<SectionPanel>` with `<Loader2>` spinner + placeholder grid
  (e.g. dashboard's "Loading live portfolio" panel). That stays.
- `SkeletonRows` accepts `rows` prop — match it to the realistic row
  count for that surface (3 for short lists, 5 for tables).

### 10.5.6 Dashboard structure

- Order is fixed: **Command center → Operational metrics → Smart Intake
  + Needs attention → Context (lease events / Ask Leasium / Activity
  feed)**.
- The metric strip carries operational counts only (Operations, Billing
  blockers, Needs review, Blocked docs). Cap at 4. Navigational counts
  (Properties, Tenants) belong in the sidebar, not the metric strip.
- The Smart Intake drop zone MUST sit in the first viewport at common
  laptop sizes (1440px). It is the product wedge.
- 2026-05-23 operator override: the metric strip moved from position 3
  (below Smart Intake) to position 2 (immediately after Command
  Center). Rationale: the operational-metric cards already carry
  status chips ("Act now" / "Blocked" / "Empty" / "Clear"), trend
  deltas, and a "next action" line per card — they're status-with-
  action, not summary stats, and an at-a-glance scan of them
  alongside the Command Center is the natural first-viewport read.
  Smart Intake + Needs attention slips one position down but stays
  comfortably above the fold on standard laptop screens.

### 10.5.7 Provider mutation guardrail

- **No Xero write, SendGrid email, Twilio SMS, tenant email, or payment
  reconciliation without explicit operator approval.** Every provider
  call is review-first: extract → confidence → source → approve/edit/
  ignore → only then mutate.
- This applies to every surface, every component, every helper.
- Cross-reference: CLAUDE.md §2.1; design-governance.md across all
  Xero/Comms/Onboarding entries.

### 10.5.7a Motion + reduced-motion

- Default motion budget per SoT §5: 120/180/260ms with the
  `var(--leasium-ease)` curve. Motion is for drawer transitions,
  hover states, upload progress, panel openings — not decoration.
- `apps/web/src/app/globals.css` honors `prefers-reduced-motion: reduce`
  by pinning every transition/animation to ~0ms when the user has
  that OS-level preference set. This is a global escape hatch — no
  per-component opt-in needed for it to take effect.
- If a component's animation conveys critical state information and
  would be incoherent at 0ms, opt that animation back in with the
  `motion-safe:` Tailwind variant on the relevant utility, then
  document the exception in the governance log. This should be rare.
- Don't add new animations longer than 260ms (SoT slow tier) without
  documenting why. Marketing animation belongs on marketing surfaces
  if/when they exist, not on operator workspaces.

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

Shipped primary navigation (2026-05-31 DoorLoop refocus):

```txt
Dashboard
Smart Intake
Properties
People          (Tenants · Owners · Vendors · later Prospects)
Work            (Maintenance · Arrears · Tasks · Comms)
Money           (Billing · Invoices · Owner statements · Xero · Bank feeds)
Insights
Settings
```

Primary hub count is 7; Settings remains visible as the utility destination.

### Navigation notes

- **Smart Intake** stays a top-level item — it is the product wedge.
- **People** is one hub for every human/relationship (Tenants · Owners · Vendors · later Prospects), each sharing one record-page shape. This is the headline DoorLoop-informed change.
- **Money** groups the finance sprawl (Billing / Statements / Xero / Basiq); **Work** groups operations + comms.
- **Insights** is the portfolio-risk layer. Compliance expiry, fire/safety risk,
  delegated owners, and evidence status belong in the Insights compliance
  snapshot and Work follow-up queues, not a new top-level Compliance nav item.
- New human/relationship surfaces live under People, not as new top-level items (§10.5.1 cap).
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
Local API-backed demo data now also exists via `make demo-seed` after migrations.
It seeds the dev-auth organisation as `Harbour Lane Property Group` and adds the
fictional entity `Rivergum Property Holdings Pty Ltd`. Use this for local
browser checks that need meaningful data rather than just frames. The seed is
idempotent and provider-inert: no Xero, Basiq, SendGrid, Twilio, payment, or
reconciliation calls.

Demo portfolio example:

```txt
Kingfisher Retail Arcade
Moorooka Trade Warehouse
Newstead Creative Offices
4 active tenants
2 upcoming rent reviews
1 insurance certificate overdue
1 tenant onboarding waiting on documents
2 billing blockers before invoice run
```

Demo tenants:
```txt
Bright Coffee Co.
Urban Dental
River Logistics
Studio North
```

Demo workflows:
```txt
Arcade lighting circuit fault
Insurance certificate overdue
Rent review due in 14 days
Xero contact mapping missing
Tenant onboarding waiting on documents
Part-paid invoice with arrears follow-up
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
