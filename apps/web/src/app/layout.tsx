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
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">
        <OperatorAuthProvider>{children}</OperatorAuthProvider>
      </body>
    </html>
  );
}
