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
      try {
        window.localStorage.setItem("leasium.appearance", "light");
        document.documentElement.dataset.theme = "light";
        document.documentElement.dataset.appearance = "light";
        document.documentElement.style.colorScheme = "light";
      } catch (_) {}
    })();
  `;
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      data-appearance="light"
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
