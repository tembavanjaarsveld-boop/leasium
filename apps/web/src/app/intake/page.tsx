"use client";

import { Dashboard } from "@/components/dashboard";
import { QueryProvider } from "@/components/query-provider";

export default function IntakePage() {
  return (
    <QueryProvider>
      <Dashboard mode="intake" />
    </QueryProvider>
  );
}
