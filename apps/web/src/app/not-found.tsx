import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";

import { LeasiumMark } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-leasium-bg px-6 py-12 text-foreground">
      <div className="grid w-full max-w-md gap-6 rounded-2xl border border-border bg-white p-8 shadow-leasiumMd">
        <div className="flex items-center gap-3">
          <LeasiumMark className="h-9 w-9" />
          <span className="text-base font-semibold tracking-tight text-leasium-navy-800">
            Relby
          </span>
        </div>
        <div className="grid gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-leasium-navy-800">
            Page not found
          </h1>
          <p className="text-sm leading-relaxed text-leasium-slate-500">
            This page does not exist or has moved. Head back to your dashboard
            to pick up where you left off.
          </p>
        </div>
        <div className="grid gap-3">
          <Link
            href="/"
            className="group inline-flex min-h-11 items-center justify-between gap-3 rounded-xl bg-leasium-blue px-4 text-sm font-semibold text-white shadow-leasiumXs transition duration-200 ease-leasium hover:bg-leasium-blue-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leasium-blue"
          >
            Back to Dashboard
            <ArrowRight
              size={16}
              aria-hidden="true"
              className="transition-transform duration-200 ease-leasium group-hover:translate-x-0.5"
            />
          </Link>
          <Link
            href="/intake"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong bg-white px-4 text-sm font-semibold text-leasium-slate-700 shadow-leasiumXs transition duration-200 ease-leasium hover:bg-leasium-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leasium-blue"
          >
            <Sparkles size={16} aria-hidden="true" />
            Open Relby AI
          </Link>
        </div>
      </div>
    </main>
  );
}
