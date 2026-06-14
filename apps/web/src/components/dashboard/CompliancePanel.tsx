"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";

import { SectionPanel, StatusBadge } from "@/components/ui";
import type { InsightsOverviewRecord } from "@/lib/api";

/**
 * CompliancePanel — compact, read-only compliance cue on the Dashboard.
 * Reads the existing `/api/v1/insights/overview` payload
 * (`compliance_snapshot`) the dashboard already loads — no new fetch.
 * Surfaces overdue / due-soon counts (danger / warning tones) with
 * operator-approved-evidence and recently-completed counts as positive
 * context, deep-linking into the operations compliance tab and Insights.
 *
 * Hidden entirely when there is no compliance data or every count is
 * zero, so an all-clear portfolio stays quiet.
 */

const COMPLIANCE_TAB_HREF = "/operations?tab=compliance";
const INSIGHTS_HREF = "/insights";

const linkClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-3 text-sm font-medium text-muted-foreground transition duration-200 ease-leasium hover:bg-muted hover:text-foreground";

export function CompliancePanel({
  overview,
  isLoading,
}: {
  overview: InsightsOverviewRecord | undefined;
  isLoading: boolean;
}) {
  const snapshot = overview?.compliance_snapshot;

  if (isLoading && !overview) {
    return null;
  }

  if (!snapshot) {
    return null;
  }

  const {
    overdue_count: overdue,
    due_soon_count: dueSoon,
    operator_approved_evidence_count: approvedEvidence,
    recently_completed_count: recentlyCompleted,
  } = snapshot;

  // All-clear / no-data portfolios stay quiet — nothing to cue.
  const hasSignal =
    overdue > 0 || dueSoon > 0 || approvedEvidence > 0 || recentlyCompleted > 0;
  if (!hasSignal) {
    return null;
  }

  const needsAttention = overdue > 0 || dueSoon > 0;

  return (
    <SectionPanel
      title="Compliance"
      description="Recurring checks and obligations across the portfolio."
      icon={<ShieldCheck size={17} className="text-primary" />}
      actions={
        <StatusBadge tone={needsAttention ? "warning" : "success"}>
          {needsAttention ? "Needs attention" : "On track"}
        </StatusBadge>
      }
    >
      <div className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {overdue > 0 ? (
            <StatusBadge tone="danger">
              {overdue} overdue
            </StatusBadge>
          ) : null}
          {dueSoon > 0 ? (
            <StatusBadge tone="warning">
              {dueSoon} due soon
            </StatusBadge>
          ) : null}
          {approvedEvidence > 0 ? (
            <StatusBadge tone="success">
              {approvedEvidence} evidence approved
            </StatusBadge>
          ) : null}
          {recentlyCompleted > 0 ? (
            <StatusBadge tone="success">
              {recentlyCompleted} recently completed
            </StatusBadge>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={COMPLIANCE_TAB_HREF} className={linkClass}>
            Open compliance
          </Link>
          <Link href={INSIGHTS_HREF} className={linkClass}>
            View insights
          </Link>
        </div>
      </div>
    </SectionPanel>
  );
}
