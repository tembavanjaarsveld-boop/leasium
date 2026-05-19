import type { Metadata } from "next";
import { OperatorAuthProvider } from "@/components/operator-auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leasium | Lease operations, automated",
  description: "Review-first automation for lease and tenant workflows.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <OperatorAuthProvider>{children}</OperatorAuthProvider>
      </body>
    </html>
  );
}
