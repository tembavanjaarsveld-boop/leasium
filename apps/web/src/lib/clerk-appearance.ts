export const clerkEmailOnlyAppearance = {
  variables: {
    colorBackground: "var(--leasium-surface)",
    colorInputBackground: "var(--leasium-surface)",
    colorText: "var(--leasium-navy-800)",
    colorTextSecondary: "var(--leasium-slate-500)",
    colorPrimary: "var(--leasium-blue)",
    colorDanger: "var(--leasium-danger)",
    borderRadius: "12px",
    fontFamily: "var(--leasium-font-sans)",
  },
  elements: {
    rootBox: "w-full",
    card:
      "rounded-2xl border border-border bg-white text-foreground shadow-leasiumSm",
    headerTitle: "text-2xl font-semibold text-foreground",
    headerSubtitle: "text-sm text-muted-foreground",
    formFieldLabel: "text-sm font-medium text-foreground",
    formFieldInput:
      "min-h-11 rounded-xl border border-border bg-white px-3 text-sm text-foreground shadow-none outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15",
    formButtonPrimary:
      "min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover active:bg-primary-pressed",
    footerActionText: "text-sm text-muted-foreground",
    footerActionLink:
      "text-sm font-semibold text-primary transition hover:text-primary-hover",
    identityPreviewText: "text-sm text-foreground",
    identityPreviewEditButton:
      "text-sm font-semibold text-primary transition hover:text-primary-hover",
    socialButtons: "hidden",
    socialButtonsBlockButton: "hidden",
    socialButtonsIconButton: "hidden",
    dividerRow: "hidden",
    dividerLine: "hidden",
    dividerText: "hidden",
  },
};
