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
        },
        border: "#E4E7EC",
        "border-strong": "#D0D5DD",
        background: "#F6F8FB",
        foreground: "#101828",
        muted: "#F2F4F7",
        "muted-foreground": "#667085",
        primary: "#245BFF",
        "primary-foreground": "#FFFFFF",
        accent: "#27D8C2",
        warning: "#F79009",
        danger: "#F04438",
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
        leasiumSm:
          "0 1px 3px rgba(16, 24, 40, 0.10), 0 1px 2px rgba(16, 24, 40, 0.06)",
        leasiumMd: "0 8px 24px rgba(16, 24, 40, 0.08)",
        leasiumLg: "0 20px 48px rgba(16, 24, 40, 0.12)",
      },
      transitionTimingFunction: {
        leasium: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
