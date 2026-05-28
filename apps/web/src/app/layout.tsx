import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { OperatorAuthProvider } from "@/components/operator-auth-provider";
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
      try {
        var mode = window.localStorage.getItem("leasium.appearance") || "system";
        var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        var theme = mode === "dark" || (mode === "system" && prefersDark) ? "dark" : "light";
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.appearance = mode;
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
        <OperatorAuthProvider>{children}</OperatorAuthProvider>
      </body>
    </html>
  );
}
