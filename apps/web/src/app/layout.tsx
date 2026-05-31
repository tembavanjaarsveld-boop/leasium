import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { OperatorAuthProvider } from "@/components/operator-auth-provider";
import { QueryProvider } from "@/components/query-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Leasium | Lease operations, automated",
  description: "Review-first automation for lease and tenant workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const themeScript = `
    (function () {
      var key = "leasium.appearance";
      var stored = null;
      try {
        stored = window.localStorage.getItem(key);
      } catch (_) {}
      var mode =
        stored === "light" || stored === "dark" || stored === "system"
          ? stored
          : "system";
      var prefersDark =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      var resolved = mode === "dark" || (mode === "system" && prefersDark)
        ? "dark"
        : "light";
      try {
        document.documentElement.dataset.theme = resolved;
        document.documentElement.dataset.appearance = mode;
        document.documentElement.style.colorScheme = resolved;
        document.documentElement.classList.toggle("dark", resolved === "dark");
      } catch (_) {}
      try {
        window.localStorage.setItem(key, mode);
      } catch (_) {}
    })();
  `;
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      data-appearance="system"
      data-theme="light"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans antialiased">
        <QueryProvider>
          <OperatorAuthProvider>{children}</OperatorAuthProvider>
        </QueryProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
