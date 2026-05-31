import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
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
            // 200/150/100/50 mirror docs/leasium-codex-design-source-of-truth.md §3.
            // Previously only exposed at the un-prefixed root aliases
            // (background, border, muted) which forced consumers to mix
            // naming layers. Codex SoT is the source of truth — these
            // make the full slate ramp directly addressable.
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
          // success-strong: WCAG AA text color for success chips on
          // success-soft backgrounds. Named so chip primitives can stop
          // using `text-[#027A48]` hex literals. Several places already
          // reference `border-leasium-success-strong/30` expecting this
          // token to exist — those borders start rendering once it does.
          "success-strong": "#027A48",
          warning: "#F79009",
          "warning-soft": "#FFFAEB",
          "warning-strong": "#B54708",
          danger: "#F04438",
          "danger-soft": "#FEF3F2",
          "danger-strong": "#B42318",
          info: "#2E90FA",
          "info-soft": "#EFF8FF",
          // Owner tag palette per Codex SoT §3. Used only by
          // lib/property-ownership.ts to colour owner/billing identity
          // chips. Each palette has matching border/bg/text colours
          // pre-balanced for WCAG AA at chip text sizes. Do not reuse
          // for status pills.
          ownertag: {
            "current-border": "#BFDBFE",
            "current-bg": "#EFF6FF",
            "current-text": "#1D4ED8",
            "sky-border": "#BAE6FD",
            "sky-bg": "#F0F9FF",
            "sky-text": "#0369A1",
            "teal-border": "#99F6E4",
            "teal-bg": "#F0FDFA",
            "teal-text": "#0F766E",
            "cyan-border": "#A5F3FC",
            "cyan-bg": "#ECFEFF",
            "cyan-text": "#0E7490",
            "lavender-border": "#DDD6FE",
            "lavender-bg": "#F5F3FF",
            "lavender-text": "#5B21B6",
            "indigo-border": "#C7D2FE",
            "indigo-bg": "#EEF2FF",
            "indigo-text": "#3730A3",
            "green-border": "#BBF7D0",
            "green-bg": "#F0FDF4",
            "green-text": "#15803D",
            "lime-border": "#D9F99D",
            "lime-bg": "#F7FEE7",
            "lime-text": "#4D7C0F",
            "amber-border": "#FDE68A",
            "amber-bg": "#FFFBEB",
            "amber-text": "#B45309",
            "rose-border": "#FECDD3",
            "rose-bg": "#FFF1F2",
            "rose-text": "#BE123C",
            "pink-border": "#FBCFE8",
            "pink-bg": "#FDF2F8",
            "pink-text": "#BE185D",
            "peach-border": "#FED7AA",
            "peach-bg": "#FFF7ED",
            "peach-text": "#C2410C",
          },
        },
        border: "#E4E7EC",
        "border-strong": "#D0D5DD",
        background: "#F6F8FB",
        foreground: "#101828",
        muted: "#F2F4F7",
        "muted-foreground": "#667085",
        primary: "#245BFF",
        "primary-foreground": "#FFFFFF",
        // Root-level short aliases for the brand-blue state variants.
        // Match the corresponding leasium.blue-* shades so consumers
        // can stay on the short alias family (bg-primary, bg-primary-soft,
        // hover:bg-primary-hover) without dropping into the leasium
        // namespace for state changes.
        "primary-hover": "#1E4FE5",
        "primary-pressed": "#173FC2",
        "primary-soft": "#EAF0FF",
        accent: "#27D8C2",
        "accent-soft": "#E8FAF7",
        // Semantic state aliases. `warning` and `danger` already existed
        // at the root; the missing -soft / -strong shades plus the full
        // success and info families now sit alongside so chips, alerts,
        // and badges can stay on short aliases end-to-end.
        success: "#12B76A",
        "success-soft": "#ECFDF3",
        "success-strong": "#027A48",
        warning: "#F79009",
        "warning-soft": "#FFFAEB",
        "warning-strong": "#B54708",
        danger: "#F04438",
        "danger-soft": "#FEF3F2",
        "danger-strong": "#B42318",
        info: "#2E90FA",
        "info-soft": "#EFF8FF",
        slate: "#344054",
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "Geist",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "SFMono-Regular",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      boxShadow: {
        leasiumXs: "0 1px 2px rgba(16, 24, 40, 0.05)",
        // Dedicated card elevation: a tight contact layer + a soft ambient
        // lift so white cards separate from the canvas without looking heavy.
        leasiumCard:
          "0 1px 2px rgba(16, 24, 40, 0.06), 0 4px 12px -2px rgba(16, 24, 40, 0.08)",
        leasiumSm:
          "0 1px 3px rgba(16, 24, 40, 0.10), 0 1px 2px rgba(16, 24, 40, 0.06)",
        leasiumMd: "0 8px 24px rgba(16, 24, 40, 0.08)",
        leasiumLg: "0 20px 48px rgba(16, 24, 40, 0.12)",
      },
      // borderRadius mirrors docs/leasium-codex-design-source-of-truth.md §5.
      // Codex defines XS through 2XL; previously none were wired into
      // Tailwind, so `rounded-leasiumMd` etc. silently fell through to
      // Tailwind defaults that only happened to align. Now token-named.
      borderRadius: {
        leasiumXs: "6px",
        leasiumSm: "8px",
        leasiumMd: "12px",
        leasiumLg: "16px",
        leasiumXl: "20px",
        leasium2xl: "24px",
      },
      // fontSize.leasium-micro per Codex SoT §4. 11px / 14px line-height /
      // 600 weight / 0.01em tracking. Reserved for chip text, kbd hints,
      // status pills, and table-row metadata — never primary content.
      // Replaces ~35 ad-hoc `text-[11px]` and `text-[10px]` usages.
      // Custom fontSize steps per Codex SoT §4. Both ratify sizes already
      // in use somewhere in the app, lifted from ad-hoc text-[Npx] callers
      // into named tokens.
      //
      // leasium-body-compact (15px / 20px / 500) - dashboard list-row
      //   hierarchy (command center rows, Ask Leasium titles). The
      //   "quieter than Body" middle step. Replaces ~7 text-[15px] uses.
      // leasium-micro (11px / 14px / 600 / 0.01em) - chip text, kbd hints,
      //   status pills, table-row metadata. Replaced ~35 text-[11px] and
      //   text-[10px] uses.
      fontSize: {
        "leasium-body-compact": [
          "15px",
          { lineHeight: "20px", fontWeight: "500" },
        ],
        "leasium-micro": [
          "11px",
          { lineHeight: "14px", fontWeight: "600", letterSpacing: "0.01em" },
        ],
      },
      // transitionDuration mirrors docs/leasium-codex-design-source-of-truth.md §5
      // (Motion). Aligns with Tailwind stock durations 150/200/300 so the
      // 80 existing `duration-200` callers continue to read as Codex Base
      // without a token migration. Authors of new motion should prefer the
      // tokenised names (`duration-leasiumBase` etc.) so future scale
      // changes are one config-file edit, not 80.
      transitionDuration: {
        leasiumFast: "150ms",
        leasiumBase: "200ms",
        leasiumSlow: "300ms",
      },
      transitionTimingFunction: {
        // `ease-leasium` (Enter / ease-out) is the default used by every
        // existing transition; keep the short name as the public API.
        leasium: "cubic-bezier(0.16, 1, 0.3, 1)",
        // ease-leasiumIn (Exit / ease-in) — for elements leaving the
        // viewport. Pair with ~75% of the enter duration.
        leasiumIn: "cubic-bezier(0.7, 0, 0.84, 0)",
        // ease-leasiumToggle (Toggle / ease-in-out) — for symmetric
        // state changes (expand/collapse, theme toggle) where neither
        // enter nor exit semantics dominate.
        leasiumToggle: "cubic-bezier(0.65, 0, 0.35, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
