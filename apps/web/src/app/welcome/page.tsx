import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LogIn,
  ShieldCheck,
  UploadCloud,
  UserRound,
  Workflow,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LeasiumMark } from "@/components/brand";

export const metadata: Metadata = {
  title: "Leasium | Sign in",
  description:
    "Sign in to the Leasium agent workspace or tenant portal.",
};

const accountSignInHref = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? "/account"
  : "https://leasium.ai/account";

const workflowSteps = [
  {
    icon: UploadCloud,
    title: "Upload",
    body: "Drop in a lease, invoice, certificate, or tenant document.",
  },
  {
    icon: FileSearch,
    title: "Review",
    body: "Extracted terms come with confidence and the source clause.",
  },
  {
    icon: ClipboardCheck,
    title: "Approve",
    body: "Apply only the values you sign off on — nothing else moves.",
  },
  {
    icon: Workflow,
    title: "Automate",
    body: "Leasium tracks dates, reminders, and billing readiness for you.",
  },
];

const featureCards = [
  {
    icon: LayoutDashboard,
    title: "Command-centre dashboard",
    body: "Critical dates, blocked billing, and documents waiting on review — surfaced before they slip.",
  },
  {
    icon: FileSearch,
    title: "Leasium AI",
    body: "Leases, invoices, and tenant documents become reviewable extractions with source clauses and confidence.",
  },
  {
    icon: Gauge,
    title: "Billing readiness",
    body: "A readiness score with the exact missing items, mapped tenants, and chargeable rules.",
  },
];

const trustPillars = [
  "Review-first automation",
  "Source-linked lease extraction",
  "Approval history and audit trail",
  "Role-based workflows",
];

export default function WelcomePage() {
  return (
    <main className="min-h-screen bg-leasium-bg text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link
          href="/welcome"
          className="inline-flex min-h-11 items-center gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leasium-blue"
        >
          <LeasiumMark className="h-9 w-9" />
          <span className="text-base font-semibold tracking-tight text-leasium-navy-800">
            Leasium
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href={accountSignInHref}
            className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 font-semibold text-leasium-slate-600 transition duration-200 ease-leasium hover:text-leasium-navy-800"
          >
            Sign in
          </Link>
          <Link
            href="/tenant-portal"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-strong bg-white px-3 font-semibold text-leasium-slate-600 shadow-leasiumXs transition duration-200 ease-leasium hover:bg-leasium-slate-50"
          >
            Tenant invite
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-6 pb-16 pt-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start lg:gap-14">
        <div className="grid gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-leasium-blue-soft px-3 py-1 text-xs font-semibold uppercase tracking-wider text-leasium-blue">
            Leasium sign in
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-leasium-navy-800 sm:text-5xl">
            Sign in to your Leasium account.
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-leasium-slate-500">
            One sign-in works for property teams and tenants. Leasium checks the
            account and opens the right workspace.
          </p>
          <div className="grid gap-3">
            <Link
              href={accountSignInHref}
              className="group inline-flex min-h-12 items-center justify-between gap-3 rounded-xl bg-leasium-blue px-5 text-sm font-semibold text-white shadow-leasiumSm transition duration-200 ease-leasium hover:bg-leasium-blue-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leasium-blue"
            >
              <span className="flex items-center gap-2">
                <LogIn size={18} aria-hidden="true" />
                Sign in
              </span>
              <ArrowRight
                size={16}
                aria-hidden="true"
                className="transition-transform duration-200 ease-leasium group-hover:translate-x-0.5"
              />
            </Link>
            <Link
              href="/tenant-portal"
              className="group inline-flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border-strong bg-white px-5 text-sm font-semibold text-leasium-slate-700 shadow-leasiumXs transition duration-200 ease-leasium hover:bg-leasium-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leasium-blue"
            >
              <span className="flex items-center gap-2">
                <UserRound size={18} aria-hidden="true" />
                I have a tenant invite
              </span>
              <ArrowRight
                size={16}
                aria-hidden="true"
                className="transition-transform duration-200 ease-leasium group-hover:translate-x-0.5"
              />
            </Link>
          </div>
          <p className="flex items-center gap-2 text-sm text-leasium-slate-500">
            <CheckCircle2
              size={16}
              aria-hidden="true"
              className="text-success-strong"
            />
            First-time tenants should open the invite link from their email.
          </p>
        </div>

        <div className="grid gap-4">
          <article className="grid gap-4 rounded-2xl border border-border bg-white p-6 shadow-leasiumMd">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-leasium-blue-soft text-leasium-blue">
                <Building2 size={21} aria-hidden="true" />
              </span>
              <div className="grid gap-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-leasium-blue">
                  Agents
                </p>
                <h2 className="text-xl font-semibold tracking-tight text-leasium-navy-800">
                  Property team workspace
                </h2>
                <p className="text-sm leading-relaxed text-leasium-slate-500">
                  Review lease intake, tenant onboarding, billing readiness,
                  maintenance, approvals, and portfolio activity.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href={accountSignInHref}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-leasium-blue px-4 text-sm font-semibold text-white shadow-leasiumXs transition duration-200 ease-leasium hover:bg-leasium-blue-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leasium-blue"
              >
                <LogIn size={16} aria-hidden="true" />
                Sign in
              </Link>
            </div>
          </article>

          <article className="grid gap-4 rounded-2xl border border-border bg-white p-6 shadow-leasiumMd">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-leasium-teal-soft text-success-strong">
                <UserRound size={21} aria-hidden="true" />
              </span>
              <div className="grid gap-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-success-strong">
                  Tenants
                </p>
                <h2 className="text-xl font-semibold tracking-tight text-leasium-navy-800">
                  Tenant portal
                </h2>
                <p className="text-sm leading-relaxed text-leasium-slate-500">
                  Sign in to continue onboarding, review lease documents, upload
                  requested items, and raise maintenance requests.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href={accountSignInHref}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-leasium-navy-800 px-4 text-sm font-semibold text-white shadow-leasiumXs transition duration-200 ease-leasium hover:bg-leasium-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leasium-blue"
              >
                <KeyRound size={16} aria-hidden="true" />
                Sign in
              </Link>
              <p className="inline-flex min-h-11 items-center text-xs leading-relaxed text-leasium-slate-500">
                New tenant? Start from the invite email so your portal links to
                the right lease.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="border-y border-border bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12">
          <div className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-leasium-blue">
              Upload. Review. Automate.
            </span>
            <h2 className="text-2xl font-bold tracking-tight text-leasium-navy-800">
              From document to controlled workflow.
            </h2>
            <p className="max-w-2xl text-sm text-leasium-slate-500">
              Every lease, invoice, certificate, and tenant document moves
              through the same four-step path. Nothing skips review.
            </p>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {workflowSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.title}
                  className="grid gap-3 rounded-2xl border border-border bg-leasium-slate-50 p-5"
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-leasium-blue-soft text-leasium-blue">
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-leasium-slate-400">
                      Step {index + 1}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold tracking-tight text-leasium-navy-800">
                    {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-leasium-slate-500">
                    {step.body}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-14">
        <div className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-leasium-blue">
            Built for daily lease operations
          </span>
          <h2 className="text-2xl font-bold tracking-tight text-leasium-navy-800">
            One workspace for every lease motion.
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {featureCards.map((card) => {
            const Icon = card.icon;
            return (
              <article
                key={card.title}
                className="grid gap-3 rounded-2xl border border-border bg-white p-6 shadow-leasiumXs"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-leasium-teal-soft text-success-strong">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <h3 className="text-lg font-semibold tracking-tight text-leasium-navy-800">
                  {card.title}
                </h3>
                <p className="text-sm leading-relaxed text-leasium-slate-500">
                  {card.body}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-y border-border bg-leasium-navy-800 text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 md:grid-cols-[1fr_1.2fr] md:items-center">
          <div className="grid gap-3">
            <h2 className="text-2xl font-bold tracking-tight">
              Review every change before it goes out.
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-white/70">
              Provider sends, Xero writes, tenant emails, and payment
              reconciliations are review-first. Every change carries the source
              clause, the confidence, and the operator who approved it.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {trustPillars.map((pillar) => (
              <li
                key={pillar}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <CheckCircle2
                  size={18}
                  aria-hidden="true"
                  className="mt-0.5 text-leasium-teal"
                />
                <span className="text-sm font-semibold text-white">
                  {pillar}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="sign-in"
        className="mx-auto grid max-w-6xl gap-6 px-6 py-14 md:grid-cols-2"
      >
        <article className="grid gap-4 rounded-2xl border border-border bg-white p-6 shadow-leasiumSm">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-leasium-blue-soft text-leasium-blue">
              <ShieldCheck size={20} aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-leasium-blue">
                Agent
              </p>
              <h3 className="text-lg font-semibold tracking-tight text-leasium-navy-800">
                Operator workspace
              </h3>
            </div>
          </div>
              <p className="text-sm leading-relaxed text-leasium-slate-500">
                For property managers and operations leads. Sign in to your
                command centre, review intake, approve workflows, and clear
                billing blockers.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href={accountSignInHref}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-leasium-blue px-4 text-sm font-semibold text-white shadow-leasiumXs transition duration-200 ease-leasium hover:bg-leasium-blue-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leasium-blue"
                >
                  Sign in <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
        </article>

        <article className="grid gap-4 rounded-2xl border border-border bg-white p-6 shadow-leasiumSm">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-leasium-teal-soft text-success-strong">
              <UploadCloud size={20} aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-success-strong">
                Tenant
              </p>
              <h3 className="text-lg font-semibold tracking-tight text-leasium-navy-800">
                Tenant portal
              </h3>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-leasium-slate-500">
            For tenants and their teams. Sign in to your portal, complete
            onboarding, submit documents, and raise maintenance requests.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={accountSignInHref}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-leasium-navy-800 px-4 text-sm font-semibold text-white shadow-leasiumXs transition duration-200 ease-leasium hover:bg-leasium-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leasium-blue"
            >
              Sign in <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <p className="inline-flex min-h-11 items-center text-xs text-leasium-slate-500">
              Have a setup link? Use the link in your invite email.
            </p>
          </div>
        </article>
      </section>

      <footer className="border-t border-border bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-xs text-leasium-slate-500">
          <div className="flex items-center gap-2">
            <LeasiumMark className="h-6 w-6" />
            <span className="font-semibold text-leasium-navy-800">Leasium</span>
            <span className="text-leasium-slate-400">
              · Lease operations, automated
            </span>
          </div>
          <p>An SKJ Capital operations platform · Private beta.</p>
        </div>
      </footer>
    </main>
  );
}
