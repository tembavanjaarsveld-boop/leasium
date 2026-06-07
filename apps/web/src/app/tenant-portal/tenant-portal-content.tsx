"use client";

import {
  SignInButton,
  SignOutButton,
  SignUpButton,
  UserButton,
  useAuth,
  useSignIn,
  useSignUp,
  useUser,
} from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  ChevronDown,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileText,
  ImagePlus,
  Loader2,
  LogIn,
  MessageSquare,
  PenLine,
  ReceiptText,
  Send,
  ShieldCheck,
  UploadCloud,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import {
  ClerkSessionUnavailableNotice,
  useAuthLoadTimeout,
} from "@/components/auth-config-notice";
import { LeasiumMark } from "@/components/brand";
import { QueryProvider } from "@/components/query-provider";
import {
  Button,
  Field,
  Input,
  SecondaryButton,
  Select,
  StatusBadge,
} from "@/components/ui";
import {
  askTenantPortalLeaseQuestion,
  claimTenantPortalAccount,
  createTenantPortalAccountMaintenanceRequest,
  createTenantPortalMaintenanceRequest,
  DocumentCategory,
  downloadTenantPortalAccountDocument,
  getTenantPortal,
  getTenantPortalAccountSession,
  getTenantPortalAccountStatus,
  getTenantPortalInvitePreview,
  MaintenancePriority,
  TenantPortalInvitePreviewRecord,
  submitTenantPortalContactChangeRequest,
  submitTenantPortalOnboarding,
  tenantPortalDocumentDownloadUrl,
  TenantPortalContactChangeRequestPayload,
  TenantPortalDocumentRecord,
  TenantLeaseQuestionRecord,
  TenantPortalMaintenanceRequestPayload,
  TenantPortalNotificationPreferencesRecord,
  TenantPortalNotificationPreferencesPayload,
  TenantPortalOnboardingSubmitPayload,
  TenantPortalRecord,
  signTenantPortalLeaseAgreement,
  updateTenantPortalAccountNotificationPreferences,
  updateTenantPortalNotificationPreferences,
  uploadTenantPortalAccountDocument,
  uploadTenantPortalDocument,
} from "@/lib/api";
import { clerkUserButtonTouchTargetAppearance } from "@/lib/clerk-appearance";

export function TenantPortalPage({
  token = null,
  view = "portal",
}: {
  token?: string | null;
  view?: "portal" | "lease";
}) {
  const tenantAccountAuthEnabled = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );

  return (
    <QueryProvider>
      {tenantAccountAuthEnabled ? (
        <TenantPortalContent token={token} view={view} />
      ) : (
        <TenantPortalContentWithoutAuth token={token} view={view} />
      )}
    </QueryProvider>
  );
}

const categoryLabels: Record<DocumentCategory, string> = {
  lease: "Lease",
  insurance: "Insurance",
  bank_guarantee: "Bank guarantee",
  onboarding: "Onboarding",
  invoice: "Invoice",
  other: "Other",
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function formatBytes(bytes: number) {
  if (bytes < 1_000_000) {
    return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function maintenanceEventLabel(value: string) {
  if (value === "tenant_submitted") {
    return "Request submitted";
  }
  if (value === "comment_added") {
    return "Team update";
  }
  return label(value);
}

function paymentTone(status: TenantPortalRecord["payment_summary"]["status"]) {
  if (status === "paid") {
    return "success" as const;
  }
  if (status === "overdue") {
    return "danger" as const;
  }
  if (status === "unpaid") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function complianceTone(status: string) {
  if (status === "received") {
    return "success" as const;
  }
  if (status === "expired") {
    return "danger" as const;
  }
  if (status === "missing") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function tenantDocStatusLabel(status: string) {
  if (status === "missing") {
    return "Not uploaded yet";
  }
  if (status === "expired") {
    return "Needs renewing";
  }
  if (status === "not_on_file") {
    return "Not required";
  }
  if (status === "confirmed_no_document") {
    return "Confirmed - certificate not on file";
  }
  if (status === "received") {
    return "Received";
  }
  return status.replaceAll("_", " ");
}

function maintenanceTone(status: string) {
  if (status === "completed") {
    return "success" as const;
  }
  if (status === "cancelled") {
    return "danger" as const;
  }
  if (
    ["awaiting_approval", "approved", "assigned", "in_progress"].includes(
      status,
    )
  ) {
    return "primary" as const;
  }
  return "warning" as const;
}

function maintenanceStatusDetail(
  status: string,
  dueDate?: string | null,
  completedAt?: string | null,
) {
  if (status === "completed") {
    return completedAt
      ? `Completed ${formatDateTime(completedAt)}.`
      : "Completed by the property team.";
  }
  if (status === "cancelled") {
    return "Closed by the property team.";
  }
  if (status === "in_progress") {
    return "A contractor or property team member is working on this.";
  }
  if (status === "assigned") {
    return "Assigned to the right person or contractor.";
  }
  if (status === "awaiting_approval") {
    return "Waiting for property team approval before work starts.";
  }
  if (status === "approved") {
    return "Approved and waiting to be scheduled.";
  }
  if (status === "triaged") {
    return dueDate
      ? `Reviewed by the property team. Target date ${formatDate(dueDate)}.`
      : "Reviewed by the property team.";
  }
  return "Submitted to the property team.";
}

function maintenanceStageIndex(status: string) {
  if (["completed", "cancelled"].includes(status)) {
    return 4;
  }
  if (status === "in_progress") {
    return 3;
  }
  if (["assigned", "approved"].includes(status)) {
    return 2;
  }
  if (["triaged", "awaiting_approval"].includes(status)) {
    return 1;
  }
  return 0;
}

function maintenanceLatestUpdate(
  request: TenantPortalRecord["maintenance_requests"][number],
) {
  const latest = latestMaintenanceHistoryEntry(request);
  if (latest) {
    return `${maintenanceEventLabel(latest.event)} ${formatDateTime(
      latest.timestamp,
    )}: ${latest.summary}`;
  }
  return `Submitted ${formatDateTime(request.requested_at)}.`;
}

function latestMaintenanceHistoryEntry(
  request: TenantPortalRecord["maintenance_requests"][number],
) {
  if (!request.history.length) {
    return null;
  }
  return [...request.history].sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
  )[0];
}

function maintenanceEvidenceCount(
  request: TenantPortalRecord["maintenance_requests"][number],
) {
  return request.document_ids.length + request.photo_document_ids.length;
}

function maintenanceNextStep(
  request: TenantPortalRecord["maintenance_requests"][number],
) {
  if (request.status === "completed") {
    return {
      label: "Completed",
      detail: request.completed_at
        ? `The property team marked this complete on ${formatDateTime(
            request.completed_at,
          )}.`
        : "The property team marked this request complete.",
      tone: "success" as const,
    };
  }
  if (request.status === "cancelled") {
    return {
      label: "Closed",
      detail:
        "This request has been closed. Send a new request if the issue returns.",
      tone: "neutral" as const,
    };
  }
  if (request.status === "in_progress") {
    return {
      label: "Work underway",
      detail:
        "The property team or contractor is working through the request now.",
      tone: "primary" as const,
    };
  }
  if (request.status === "assigned") {
    return {
      label: "Scheduling",
      detail:
        "The request has been assigned and the next step is attendance or scheduling.",
      tone: "primary" as const,
    };
  }
  if (request.status === "approved") {
    return {
      label: "Approved",
      detail:
        "The work is approved and waiting for the property team to schedule it.",
      tone: "primary" as const,
    };
  }
  if (request.status === "awaiting_approval") {
    return {
      label: "Approval review",
      detail:
        "The property team is checking approval before the work can proceed.",
      tone: "warning" as const,
    };
  }
  if (request.status === "triaged") {
    return {
      label: "Team reviewed",
      detail: request.due_date
        ? `The request has been reviewed. Target date ${formatDate(
            request.due_date,
          )}.`
        : "The request has been reviewed and is waiting for the next team step.",
      tone: "primary" as const,
    };
  }
  return {
    label: "With the team",
    detail: "The property team has your request and will triage the next step.",
    tone: "warning" as const,
  };
}

function maintenanceTenantAction(
  request: TenantPortalRecord["maintenance_requests"][number],
) {
  if (request.status === "completed") {
    return {
      label: "Check the result",
      detail:
        "If the issue has returned or the repair is not right, submit a new request with the latest details.",
      timing: request.completed_at
        ? `Completed ${formatDateTime(request.completed_at)}`
        : "Marked complete",
      tone: "success" as const,
    };
  }
  if (request.status === "cancelled") {
    return {
      label: "No action needed",
      detail:
        "This request has been closed. Send a new request if you still need help.",
      timing: "Closed",
      tone: "neutral" as const,
    };
  }
  if (request.status === "in_progress") {
    return {
      label: "Watch for access",
      detail:
        "Keep access clear for the agreed time and add a new request if conditions change.",
      timing: request.due_date
        ? `Target ${formatDate(request.due_date)}`
        : "Work underway",
      tone: "primary" as const,
    };
  }
  if (["assigned", "approved"].includes(request.status)) {
    return {
      label: "Wait for scheduling",
      detail:
        "The team has moved this forward. Watch for an attendance time or access request.",
      timing: request.due_date
        ? `Target ${formatDate(request.due_date)}`
        : "Scheduling next",
      tone: "primary" as const,
    };
  }
  if (request.status === "awaiting_approval") {
    return {
      label: "No tenant action",
      detail:
        "The property team is checking approval. They may contact you if access or more detail is needed.",
      timing: "Approval review",
      tone: "warning" as const,
    };
  }
  if (request.status === "triaged") {
    return {
      label: "Ready for next step",
      detail:
        "The request has been reviewed. Keep an eye out for scheduling or team questions.",
      timing: request.due_date
        ? `Target ${formatDate(request.due_date)}`
        : "Reviewed",
      tone: "primary" as const,
    };
  }
  return {
    label: "Nothing else yet",
    detail:
      "The request is with the property team. Add a new request only if the issue changes or becomes urgent.",
    timing: `Submitted ${formatDateTime(request.requested_at)}`,
    tone: "warning" as const,
  };
}

function maintenanceRequestSortValue(
  request: TenantPortalRecord["maintenance_requests"][number],
) {
  const closed = ["completed", "cancelled"].includes(request.status);
  const activityAt =
    latestMaintenanceHistoryEntry(request)?.timestamp ??
    request.completed_at ??
    request.requested_at;
  return `${closed ? "1" : "0"}-${String(
    Number.MAX_SAFE_INTEGER - new Date(activityAt).getTime(),
  ).padStart(16, "0")}`;
}

type TenantPortalActivityItem = {
  key: string;
  title: string;
  detail: string;
  timestamp: string;
  tone: "primary" | "success" | "warning" | "neutral";
};

type TenantPortalActionItem = {
  key: string;
  title: string;
  detail: string;
  tone: "primary" | "success" | "warning" | "danger" | "neutral";
};

type TenantAccountPortalState = {
  portal: TenantPortalRecord;
  authToken: string | null;
  userKey: string;
  routeKey: string;
};

type MaintenanceSummary = {
  openCount: number;
  inProgressCount: number;
  awaitingReviewCount: number;
  completedCount: number;
  nextDueDate: string | null;
  latestOpenRequest: TenantPortalRecord["maintenance_requests"][number] | null;
  latestCompletedRequest:
    | TenantPortalRecord["maintenance_requests"][number]
    | null;
};

function buildTenantPortalActivity(portal: TenantPortalRecord) {
  const items: TenantPortalActivityItem[] = [];

  function addActivity(item: TenantPortalActivityItem | null) {
    if (item?.timestamp) {
      items.push(item);
    }
  }

  addActivity(
    portal.onboarding.submitted_at
      ? {
          key: `onboarding-${portal.onboarding.id}`,
          title: "Onboarding sent",
          detail: "Your details were sent to the property team for review.",
          timestamp: portal.onboarding.submitted_at,
          tone: "primary",
        }
      : portal.onboarding.last_sent_at
        ? {
            key: `invite-${portal.onboarding.id}`,
            title: "Portal invite sent",
            detail: "The property team sent this tenant portal invite.",
            timestamp: portal.onboarding.last_sent_at,
            tone: "neutral",
          }
        : null,
  );

  addActivity(
    portal.lease_agreement.signed_at
      ? {
          key: "lease-signed",
          title: "Lease signed",
          detail: "Your lease pack has been signed.",
          timestamp: portal.lease_agreement.signed_at,
          tone: "success",
        }
      : null,
  );

  portal.lease_agreement.questions.forEach((question) => {
    addActivity(
      question.answered_at
        ? {
            key: `lease-question-answered-${question.id}`,
            title: "Lease question answered",
            detail: question.clause_reference
              ? `The team responded to your question about ${question.clause_reference}.`
              : "The team responded to one of your lease questions.",
            timestamp: question.answered_at,
            tone: "success",
          }
        : question.asked_at
          ? {
              key: `lease-question-asked-${question.id}`,
              title: "Lease question sent",
              detail: question.clause_reference
                ? `Question raised for ${question.clause_reference}.`
                : "A lease question was sent to the property team.",
              timestamp: question.asked_at,
              tone: "warning",
            }
          : null,
    );
  });

  portal.compliance.uploaded_documents.forEach((document) => {
    addActivity({
      key: `document-${document.id}`,
      title: "Document uploaded",
      detail: `${document.filename} - ${categoryLabels[document.category]}.`,
      timestamp: document.created_at,
      tone: "success",
    });
  });

  portal.maintenance_requests.forEach((request) => {
    if (request.history.length) {
      request.history.forEach((entry, index) => {
        addActivity({
          key: `maintenance-history-${request.id}-${index}`,
          title: maintenanceEventLabel(entry.event),
          detail: `${request.title} - ${entry.summary}`,
          timestamp: entry.timestamp,
          tone:
            entry.status === "completed"
              ? "success"
              : entry.status === "cancelled"
                ? "neutral"
                : "primary",
        });
      });
      return;
    }

    addActivity({
      key: `maintenance-${request.id}`,
      title: "Maintenance request sent",
      detail: request.title,
      timestamp: request.requested_at,
      tone: "primary",
    });
  });

  portal.contact_change_requests.forEach((request) => {
    addActivity(
      request.applied_at
        ? {
            key: `contact-change-applied-${request.id}`,
            title: "Contact details updated",
            detail: "Your saved contact details were updated.",
            timestamp: request.applied_at,
            tone: "success",
          }
        : request.dismissed_at
          ? {
              key: `contact-change-dismissed-${request.id}`,
              title: "Contact request closed",
              detail:
                "The property team reviewed your contact detail request and left your saved details unchanged.",
              timestamp: request.dismissed_at,
              tone: "neutral",
            }
          : request.submitted_at
            ? {
                key: `contact-change-submitted-${request.id}`,
                title: "Contact request sent",
                detail:
                  "Your requested contact detail changes are with the property team.",
                timestamp: request.submitted_at,
                tone: "warning",
              }
            : null,
    );
  });

  addActivity(
    portal.notification_preferences.updated_at
      ? {
          key: "notification-preferences",
          title: "Preferences saved",
          detail: "Your portal notification preferences were updated.",
          timestamp: portal.notification_preferences.updated_at,
          tone: "neutral",
        }
      : null,
  );

  return items
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() -
        new Date(left.timestamp).getTime(),
    )
    .slice(0, 6);
}

function tenantPortalActivitySummaryText(
  activities: TenantPortalActivityItem[],
) {
  if (!activities.length) {
    return [
      "Tenant portal activity summary",
      "No recent portal activity is available yet.",
    ].join("\n");
  }

  return [
    "Tenant portal activity summary",
    `${activities.length} recent portal update${
      activities.length === 1 ? "" : "s"
    }`,
    "",
    ...activities.map(
      (activity) =>
        `- ${formatDateTime(activity.timestamp)} | ${activity.title} | ${
          activity.detail
        }`,
    ),
  ].join("\n");
}

function buildTenantPortalActionItems(
  portal: TenantPortalRecord,
  openMaintenanceCount: number,
) {
  const items: TenantPortalActionItem[] = [];
  const blockedDocuments = portal.compliance.items.filter((item) =>
    ["missing", "expired"].includes(item.status),
  );
  const pendingContactRequests = portal.contact_change_requests.filter(
    (request) => request.status === "submitted",
  );

  if (portal.payment_summary.status === "overdue") {
    items.push({
      key: "overdue-payment",
      title: "Payment overdue",
      detail: `${portal.payment_summary.overdue_count} overdue invoice${
        portal.payment_summary.overdue_count === 1 ? "" : "s"
      } need review.`,
      tone: "danger",
    });
  } else if (portal.payment_summary.status === "unpaid") {
    items.push({
      key: "unpaid-payment",
      title: "Payment due",
      detail: `${formatMoney(
        portal.payment_summary.outstanding_cents,
      )} outstanding across approved invoices.`,
      tone: "warning",
    });
  }

  if (blockedDocuments.length) {
    items.push({
      key: "documents-needed",
      title: "Documents needed",
      detail: `${blockedDocuments.length} compliance item${
        blockedDocuments.length === 1 ? "" : "s"
      } need updated files.`,
      tone: "warning",
    });
  }

  if (portal.lease_agreement.status !== "signed") {
    items.push({
      key: "lease-signing",
      title: "Lease pack pending",
      detail:
        "Review and sign the lease pack when the property team releases it.",
      tone: "primary",
    });
  }

  if (pendingContactRequests.length) {
    items.push({
      key: "contact-review",
      title: "Contact change in review",
      detail:
        "The property team is reviewing your requested contact detail update.",
      tone: "primary",
    });
  }

  if (openMaintenanceCount) {
    items.push({
      key: "maintenance-open",
      title: "Maintenance active",
      detail: `${openMaintenanceCount} request${
        openMaintenanceCount === 1 ? "" : "s"
      } still open with the property team.`,
      tone: "primary",
    });
  }

  if (!items.length) {
    items.push({
      key: "all-clear",
      title: "Nothing needs attention",
      detail:
        "Your portal is up to date across payments, documents, lease, and maintenance.",
      tone: "success",
    });
  }

  return items.slice(0, 4);
}

function buildMaintenanceSummary(
  requests: TenantPortalRecord["maintenance_requests"],
): MaintenanceSummary {
  const openRequests = requests.filter(
    (request) => !["completed", "cancelled"].includes(request.status),
  );
  const sortedOpenRequests = [...openRequests].sort(
    (left, right) =>
      new Date(right.requested_at).getTime() -
      new Date(left.requested_at).getTime(),
  );
  const completedRequests = requests
    .filter((request) => request.status === "completed")
    .sort(
      (left, right) =>
        new Date(right.completed_at ?? right.requested_at).getTime() -
        new Date(left.completed_at ?? left.requested_at).getTime(),
    );
  const dueDates = openRequests
    .map((request) => request.due_date)
    .filter((dueDate): dueDate is string => Boolean(dueDate))
    .sort(
      (left, right) =>
        new Date(`${left}T00:00:00`).getTime() -
        new Date(`${right}T00:00:00`).getTime(),
    );

  return {
    openCount: openRequests.length,
    inProgressCount: openRequests.filter((request) =>
      ["assigned", "in_progress"].includes(request.status),
    ).length,
    awaitingReviewCount: openRequests.filter((request) =>
      ["requested", "triaged", "awaiting_approval", "approved"].includes(
        request.status,
      ),
    ).length,
    completedCount: completedRequests.length,
    nextDueDate: dueDates[0] ?? null,
    latestOpenRequest: sortedOpenRequests[0] ?? null,
    latestCompletedRequest: completedRequests[0] ?? null,
  };
}

function priorityTone(priority: MaintenancePriority) {
  if (priority === "urgent") {
    return "danger" as const;
  }
  if (priority === "high") {
    return "warning" as const;
  }
  if (priority === "low") {
    return "neutral" as const;
  }
  return "primary" as const;
}

function portalScopeLabel(portal: TenantPortalRecord) {
  if (portal.auth.mode === "tenant_portal_account") {
    return "Account scoped";
  }
  return portal.auth.dev_fallback ? "Token fallback" : "Token scoped";
}

function tenantDisplayName(tenant: TenantPortalRecord["tenant"]) {
  return tenant.trading_name || tenant.legal_name;
}

function onboardingSubmitted(portal: TenantPortalRecord) {
  return (
    Boolean(portal.onboarding.submitted_at) ||
    ["submitted", "reviewed", "applied"].includes(portal.onboarding.status)
  );
}

function onboardingApplied(portal: TenantPortalRecord) {
  return portal.onboarding.status === "applied";
}

function tenantOnboardingStatusLabel(
  status: TenantPortalRecord["onboarding"]["status"],
) {
  if (status === "submitted" || status === "reviewed") {
    return "In review";
  }
  return label(status);
}

function blockingLeaseQuestion(question: TenantLeaseQuestionRecord) {
  return ["open", "needs_revision", "legal_review"].includes(question.status);
}

function leaseAgreementTone(
  status: TenantPortalRecord["lease_agreement"]["status"],
) {
  if (status === "signed") {
    return "success" as const;
  }
  if (status === "questions_open") {
    return "warning" as const;
  }
  if (status === "ready_to_sign") {
    return "primary" as const;
  }
  return "neutral" as const;
}

function leaseAgreementLabel(
  status: TenantPortalRecord["lease_agreement"]["status"],
) {
  if (status === "questions_open") {
    return "Questions open";
  }
  if (status === "ready_to_sign") {
    return "Ready to sign";
  }
  if (status === "signed") {
    return "Signed";
  }
  return "Review pending";
}

function leaseQuestionStatusLabel(status: TenantLeaseQuestionRecord["status"]) {
  if (status === "legal_review") {
    return "Legal review";
  }
  if (status === "needs_revision") {
    return "Needs revision";
  }
  return label(status);
}

function leaseQuestionTone(status: TenantLeaseQuestionRecord["status"]) {
  if (status === "answered" || status === "resolved") {
    return "success" as const;
  }
  if (status === "legal_review" || status === "needs_revision") {
    return "warning" as const;
  }
  return "primary" as const;
}

function tenantPortalClaimErrorMessage(
  error: unknown,
  signedInEmail?: string | null,
  inviteEmail?: string | null,
) {
  const message =
    error instanceof Error
      ? error.message
      : "Something went wrong setting up your tenant account.";
  const lower = message.toLowerCase();
  if (lower.includes("already linked to another tenant")) {
    return "This login is already linked to another tenant. Sign out and choose the tenant login for this invite, or ask the property team to unlink the old portal access and send a fresh invite.";
  }
  if (lower.includes("invite link has been used")) {
    return "This invite link has already been claimed. Sign in with the tenant account that used it, or ask the property team for a fresh invite.";
  }
  if (lower.includes("revoked")) {
    return "This tenant login has been revoked by the property team. Ask them to restore access or send a fresh invite.";
  }
  if (lower.includes("login email must match")) {
    if (signedInEmail && inviteEmail) {
      if (normaliseEmail(signedInEmail) === normaliseEmail(inviteEmail)) {
        return `The browser is signed in as ${signedInEmail}, but Leasium could not verify that session on the server. Reset sign-in, then enter the code for ${inviteEmail} again.`;
      }
      return `Leasium could not verify that ${signedInEmail} owns this invite for ${inviteEmail}. Sign out, then sign in directly with ${inviteEmail}.`;
    }
    if (inviteEmail) {
      return `Leasium could not verify that this account owns the invite for ${inviteEmail}. Sign out, then sign in directly with ${inviteEmail}.`;
    }
  }
  return message;
}

function tenantPortalClaimNeedsDifferentLogin(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.toLowerCase().includes("already linked to another tenant") ||
      error.message.toLowerCase().includes("login email must match"))
  );
}

function tenantPortalClaimNeedsSessionReset(
  error: unknown,
  signedInEmail?: string | null,
  inviteEmail?: string | null,
) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("login email must match") &&
    Boolean(signedInEmail) &&
    Boolean(inviteEmail) &&
    normaliseEmail(signedInEmail) === normaliseEmail(inviteEmail)
  );
}

function normaliseEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

type ClerkTenantProfilePayload = {
  firstName?: string;
  lastName?: string;
  legalAccepted?: boolean;
  password?: string;
};

function splitTenantDisplayNameForClerk(value: string | null | undefined) {
  const name = (value ?? "").trim().replace(/\s+/g, " ");
  if (!name) return {};
  const [firstName, ...lastNameParts] = name.split(" ");
  return {
    firstName,
    lastName: lastNameParts.length ? lastNameParts.join(" ") : name,
  };
}

function tenantProfilePayloadForMissingFields({
  missingFields,
  firstName,
  lastName,
  legalAccepted,
}: {
  missingFields: readonly string[];
  firstName: string;
  lastName: string;
  legalAccepted: boolean;
}) {
  const payload: ClerkTenantProfilePayload = {};
  if (missingFields.includes("first_name") && firstName.trim()) {
    payload.firstName = firstName.trim();
  }
  if (missingFields.includes("last_name") && lastName.trim()) {
    payload.lastName = lastName.trim();
  }
  if (missingFields.includes("legal_accepted")) {
    payload.legalAccepted = legalAccepted;
  }
  if (missingFields.includes("password")) {
    payload.password = generateTenantClerkPassword();
  }
  return payload;
}

function generateTenantClerkPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (byte) => alphabet[byte % alphabet.length])
    .join("")
    .slice(0, 24);
  return `Ls!9-${random}-Aa7`;
}

function canAutofillClerkAccountFields({
  missingFields,
  firstName,
  lastName,
}: {
  missingFields: readonly string[];
  firstName: string;
  lastName: string;
}) {
  return (
    missingFields.length > 0 &&
    missingFields.every((field) => {
      if (field === "first_name") return Boolean(firstName.trim());
      if (field === "last_name") return Boolean(lastName.trim());
      if (field === "password") return true;
      return false;
    })
  );
}

function unsupportedClerkRequirementFields(missingFields: readonly string[]) {
  return missingFields.filter(
    (field) =>
      !["first_name", "last_name", "legal_accepted", "password"].includes(
        field,
      ),
  );
}

function clerkRequirementLabel(field: string) {
  if (field === "password") return "a password";
  if (field === "username") return "a username";
  if (field === "phone_number") return "a phone number";
  return field.replaceAll("_", " ");
}

function unsupportedClerkRequirementsMessage(fields: readonly string[]) {
  const fieldNames = fields.map(clerkRequirementLabel).join(", ");
  return `This tenant account needs ${fieldNames} before it can continue. Ask the property team to update the tenant sign-up settings, then try again.`;
}

function clerkFlowErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "errors" in error) {
    const errors = (
      error as { errors?: Array<{ longMessage?: string; message?: string }> }
    ).errors;
    const firstError = errors?.[0];
    if (firstError?.longMessage) return firstError.longMessage;
    if (firstError?.message) return firstError.message;
  }
  if (error instanceof Error) return error.message;
  return "Could not complete tenant sign-in.";
}

function clerkErrorCode(error: unknown) {
  if (error && typeof error === "object" && "errors" in error) {
    return (error as { errors?: Array<{ code?: string }> }).errors?.[0]?.code;
  }
  return null;
}

function TenantInviteEmailCodeGate({
  claimable,
  initialEmail,
  tenantDisplayName,
}: {
  claimable: boolean;
  initialEmail: string | null;
  tenantDisplayName: string | null;
}) {
  const { signIn, fetchStatus: signInFetchStatus } = useSignIn();
  const { signUp, fetchStatus: signUpFetchStatus } = useSignUp();
  const inviteNameFields = useMemo(
    () => splitTenantDisplayNameForClerk(tenantDisplayName),
    [tenantDisplayName],
  );
  const [email, setEmail] = useState(initialEmail ?? "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "requirements">("email");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [firstName, setFirstName] = useState(inviteNameFields.firstName ?? "");
  const [lastName, setLastName] = useState(inviteNameFields.lastName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fetching =
    busy ||
    signInFetchStatus === "fetching" ||
    signUpFetchStatus === "fetching";

  useEffect(() => {
    if (step === "email") {
      setEmail(initialEmail ?? "");
      setFirstName(inviteNameFields.firstName ?? "");
      setLastName(inviteNameFields.lastName ?? "");
    }
  }, [
    initialEmail,
    inviteNameFields.firstName,
    inviteNameFields.lastName,
    step,
  ]);

  const finaliseSignIn = useCallback(async () => {
    if (!signIn) return;
    const { error: finaliseError } = await signIn.finalize();
    if (finaliseError) setError(clerkFlowErrorMessage(finaliseError));
  }, [signIn]);

  const finaliseSignUp = useCallback(async () => {
    if (!signUp) return;
    const { error: finaliseError } = await signUp.finalize();
    if (finaliseError) setError(clerkFlowErrorMessage(finaliseError));
  }, [signUp]);

  const transferToSignUp = useCallback(async () => {
    if (!signUp) {
      setError("Tenant sign-up is still loading.");
      return;
    }
    const { error: transferError } = await signUp.create({ transfer: true });
    if (transferError) {
      setError(clerkFlowErrorMessage(transferError));
      return;
    }
    if (signUp.status === "complete") {
      await finaliseSignUp();
      return;
    }
    if (signUp.status === "missing_requirements") {
      if (
        canAutofillClerkAccountFields({
          missingFields: signUp.missingFields,
          firstName,
          lastName,
        })
      ) {
        const { error: updateError } = await signUp.update(
          tenantProfilePayloadForMissingFields({
            missingFields: signUp.missingFields,
            firstName,
            lastName,
            legalAccepted,
          }),
        );
        if (updateError) {
          setError(clerkFlowErrorMessage(updateError));
          return;
        }
        const updatedStatus: string | null = signUp.status;
        if (updatedStatus === "complete") {
          await finaliseSignUp();
          return;
        }
      }
      setStep("requirements");
      return;
    }
    setError(
      "Tenant account needs additional Clerk setup before it can continue.",
    );
  }, [finaliseSignUp, firstName, lastName, legalAccepted, signUp]);

  const sendCode = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (!signIn) {
        setError("Tenant sign-in is still loading.");
        return;
      }
      const nextEmail = email.trim();
      if (!nextEmail) {
        setError("Enter the tenant email before sending a code.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const { error: createError } = await signIn.create({
          identifier: nextEmail,
          signUpIfMissing: claimable ? true : undefined,
        });
        if (createError) {
          setError(clerkFlowErrorMessage(createError));
          return;
        }
        const { error: sendError } = await signIn.emailCode.sendCode();
        if (sendError) {
          setError(clerkFlowErrorMessage(sendError));
          return;
        }
        setEmail(nextEmail);
        setCode("");
        setStep("code");
      } catch (caught) {
        setError(clerkFlowErrorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [claimable, email, signIn],
  );

  const verifyCode = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (!signIn) {
        setError("Tenant sign-in is still loading.");
        return;
      }
      const nextCode = code.trim();
      if (!nextCode) {
        setError("Enter the code from your email.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const { error: verifyError } = await signIn.emailCode.verifyCode({
          code: nextCode,
        });
        if (verifyError) {
          if (clerkErrorCode(verifyError) === "sign_up_if_missing_transfer") {
            await transferToSignUp();
            return;
          }
          setError(clerkFlowErrorMessage(verifyError));
          return;
        }
        if (signIn.status === "complete") {
          await finaliseSignIn();
          return;
        }
        if (signIn.status === "needs_second_factor") {
          setError(
            "This login needs another verification step before continuing.",
          );
          return;
        }
        if (signIn.status === "needs_client_trust") {
          setError(
            "This browser needs another verification step before continuing.",
          );
          return;
        }
        setError("Tenant sign-in is not complete yet.");
      } catch (caught) {
        setError(clerkFlowErrorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [code, finaliseSignIn, signIn, transferToSignUp],
  );

  const resetToEmailStep = useCallback(() => {
    signIn?.reset();
    signUp?.reset();
    setStep("email");
    setCode("");
    setLegalAccepted(false);
    setError(null);
  }, [signIn, signUp]);

  const completeRequirements = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (!signUp) {
        setError("Tenant sign-up is still loading.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const missingFields = signUp.missingFields;
        const unsupportedFields =
          unsupportedClerkRequirementFields(missingFields);
        if (unsupportedFields.length) {
          setError(unsupportedClerkRequirementsMessage(unsupportedFields));
          return;
        }
        if (missingFields.includes("first_name") && !firstName.trim()) {
          setError("Enter the tenant's first name to finish account setup.");
          return;
        }
        if (missingFields.includes("last_name") && !lastName.trim()) {
          setError("Enter the tenant's last name to finish account setup.");
          return;
        }
        const updatePayload = tenantProfilePayloadForMissingFields({
          missingFields,
          firstName,
          lastName,
          legalAccepted,
        });
        const { error: updateError } = await signUp.update(updatePayload);
        if (updateError) {
          setError(clerkFlowErrorMessage(updateError));
          return;
        }
        if (signUp.status === "complete") {
          await finaliseSignUp();
          return;
        }
        setError(
          "Tenant account still needs Clerk-required fields before it can continue.",
        );
      } catch (caught) {
        setError(clerkFlowErrorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [finaliseSignUp, firstName, lastName, legalAccepted, signUp],
  );

  if (step === "requirements") {
    const missingFields = signUp?.missingFields ?? [];
    const needsFirstName = missingFields.includes("first_name");
    const needsLastName = missingFields.includes("last_name");
    const needsLegal = missingFields.includes("legal_accepted");
    const unsupportedFields = unsupportedClerkRequirementFields(missingFields);
    return (
      <form className="grid gap-3 text-sm" onSubmit={completeRequirements}>
        <p className="text-foreground">
          Your email is verified. Finish the account step to continue.
        </p>
        {needsFirstName ? (
          <Field label="First name">
            <Input
              autoComplete="given-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </Field>
        ) : null}
        {needsLastName ? (
          <Field label="Last name">
            <Input
              autoComplete="family-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </Field>
        ) : null}
        {needsLegal ? (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={legalAccepted}
              onChange={(event) => setLegalAccepted(event.target.checked)}
            />
            <span>I accept the tenant account terms.</span>
          </label>
        ) : null}
        {unsupportedFields.length ? (
          <div className="text-danger">
            {unsupportedClerkRequirementsMessage(unsupportedFields)}
          </div>
        ) : null}
        {error ? <div className="text-danger">{error}</div> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={
              fetching ||
              (needsFirstName && !firstName.trim()) ||
              (needsLastName && !lastName.trim()) ||
              (needsLegal && !legalAccepted) ||
              unsupportedFields.length > 0
            }
          >
            {fetching ? <Loader2 size={16} className="animate-spin" /> : null}
            Continue
          </Button>
          <SecondaryButton
            type="button"
            disabled={fetching}
            onClick={resetToEmailStep}
          >
            Use another email
          </SecondaryButton>
        </div>
      </form>
    );
  }

  if (step === "code") {
    return (
      <form className="grid gap-3 text-sm" onSubmit={verifyCode}>
        <p className="text-foreground">
          We sent a one-time code to{" "}
          <span className="font-medium">{email}</span>.
        </p>
        <Field label="Email code">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        {error ? <div className="text-danger">{error}</div> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={fetching || !code.trim()}>
            {fetching ? <Loader2 size={16} className="animate-spin" /> : null}
            Verify code
          </Button>
          <SecondaryButton
            type="button"
            disabled={fetching}
            onClick={() => sendCode()}
          >
            Resend code
          </SecondaryButton>
          <SecondaryButton
            type="button"
            disabled={fetching}
            onClick={resetToEmailStep}
          >
            Use another email
          </SecondaryButton>
        </div>
      </form>
    );
  }

  return (
    <form className="grid gap-3 text-sm" onSubmit={sendCode}>
      <p className="text-foreground">
        Sign in with a one-time code. We&apos;ll use this login for your tenant
        portal.
      </p>
      <Field label="Email">
        <Input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      {error ? <div className="text-danger">{error}</div> : null}
      <Button type="submit" disabled={fetching || !email.trim()}>
        {fetching ? <Loader2 size={16} className="animate-spin" /> : null}
        Send code
      </Button>
    </form>
  );
}

function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4">
          <LeasiumMark />
          <div>
            <h1 className="text-lg font-semibold">Leasium</h1>
            <p className="text-sm text-muted-foreground">Tenant portal</p>
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}

function TenantPortalTrustState({
  title,
  detail,
  recovery,
  loading = false,
}: {
  title: string;
  detail: string;
  recovery?: string;
  loading?: boolean;
}) {
  return (
    <PortalShell>
      <div className="grid min-h-[70vh] place-items-center px-5 py-8">
        <div
          className="grid max-w-md gap-4 rounded-md border border-border bg-white p-6 text-center"
          role={loading ? "status" : undefined}
        >
          <div className="mx-auto flex size-11 items-center justify-center rounded-full border border-primary/20 bg-primary/5 text-primary">
            {loading ? (
              <Loader2 className="animate-spin" size={22} />
            ) : (
              <ShieldCheck size={22} />
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {detail}
            </p>
            {recovery ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {recovery}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </PortalShell>
  );
}

type OnboardingStepState = "complete" | "current" | "waiting" | "locked";

const onboardingStepTone: Record<
  OnboardingStepState,
  "success" | "primary" | "warning" | "neutral"
> = {
  complete: "success",
  current: "primary",
  waiting: "warning",
  locked: "neutral",
};

const onboardingStepLabel: Record<OnboardingStepState, string> = {
  complete: "Done",
  current: "Now",
  waiting: "Waiting",
  locked: "Next",
};

function OnboardingStep({
  title,
  detail,
  state,
}: {
  title: string;
  detail: string;
  state: OnboardingStepState;
}) {
  return (
    <div className="grid gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{title}</span>
        <StatusBadge tone={onboardingStepTone[state]}>
          {onboardingStepLabel[state]}
        </StatusBadge>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {detail ? (
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

function TenantPortalOverviewPanel({
  actionItems,
  recentActivity,
  maintenanceSummary,
}: {
  actionItems: TenantPortalActionItem[];
  recentActivity: TenantPortalActivityItem[];
  maintenanceSummary: MaintenanceSummary;
}) {
  const latestActivity = recentActivity[0] ?? null;

  return (
    <section className="grid gap-3 overflow-hidden rounded-md border border-border bg-white p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Needs Attention</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Current tenant-side items before you scan the full portal.
            </p>
          </div>
          <StatusBadge tone={actionItems[0]?.tone ?? "neutral"}>
            {actionItems.length} item{actionItems.length === 1 ? "" : "s"}
          </StatusBadge>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {actionItems.map((item) => (
            <div
              key={item.key}
              className="min-w-0 rounded-md border border-border bg-muted/30 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 font-medium">{item.title}</div>
                <StatusBadge tone={item.tone}>{label(item.tone)}</StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid min-w-0 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Latest update
          </div>
          {latestActivity ? (
            <div className="mt-2 grid min-w-0 gap-1">
              <div className="font-medium">{latestActivity.title}</div>
              <div className="text-muted-foreground">
                {latestActivity.detail}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDateTime(latestActivity.timestamp)}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-muted-foreground">
              Activity will appear here as your portal updates.
            </div>
          )}
        </div>
        <div className="grid gap-2 border-t border-border pt-3 text-left sm:grid-cols-3 sm:text-center">
          <div className="min-w-0">
            <div className="text-lg font-semibold">
              {maintenanceSummary.openCount}
            </div>
            <div className="text-xs text-muted-foreground">Open</div>
          </div>
          <div className="min-w-0">
            <div className="text-lg font-semibold">
              {maintenanceSummary.inProgressCount}
            </div>
            <div className="text-xs text-muted-foreground">Working</div>
          </div>
          <div className="min-w-0">
            <div className="text-lg font-semibold">
              {maintenanceSummary.completedCount}
            </div>
            <div className="text-xs text-muted-foreground">Done</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MaintenanceSummaryPanel({ summary }: { summary: MaintenanceSummary }) {
  const nextOpenRequest = summary.latestOpenRequest;
  const latestCompletedRequest = summary.latestCompletedRequest;

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Open requests</div>
          <StatusBadge tone={summary.openCount ? "primary" : "success"}>
            {summary.openCount}
          </StatusBadge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {nextOpenRequest
            ? `${nextOpenRequest.title} - ${maintenanceStatusDetail(
                nextOpenRequest.status,
                nextOpenRequest.due_date,
                nextOpenRequest.completed_at,
              )}`
            : "No active maintenance requests."}
        </p>
      </div>
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Status visibility</div>
          <StatusBadge
            tone={summary.awaitingReviewCount ? "warning" : "primary"}
          >
            {summary.awaitingReviewCount} review
          </StatusBadge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {summary.inProgressCount
            ? `${summary.inProgressCount} request${
                summary.inProgressCount === 1 ? "" : "s"
              } assigned or in progress.`
            : summary.nextDueDate
              ? `Next target date ${formatDate(summary.nextDueDate)}.`
              : "Every request shows the latest team update below."}
        </p>
      </div>
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Recently completed</div>
          <StatusBadge tone={latestCompletedRequest ? "success" : "neutral"}>
            {summary.completedCount}
          </StatusBadge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {latestCompletedRequest
            ? `${latestCompletedRequest.title} - ${maintenanceStatusDetail(
                latestCompletedRequest.status,
                latestCompletedRequest.due_date,
                latestCompletedRequest.completed_at,
              )}`
            : "Completed requests will stay visible here for audit history."}
        </p>
      </div>
    </div>
  );
}

function MaintenanceStatusTimeline({
  request,
}: {
  request: TenantPortalRecord["maintenance_requests"][number];
}) {
  const stages = [
    "Submitted",
    "Reviewed",
    "Scheduled",
    "Working",
    request.status === "cancelled" ? "Closed" : "Complete",
  ];
  const activeStage = maintenanceStageIndex(request.status);

  return (
    <div className="grid gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-foreground">Status path</span>
        <span className="text-muted-foreground">
          {maintenanceLatestUpdate(request)}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {stages.map((stage, index) => {
          const isActive = index <= activeStage;
          return (
            <div key={stage} className="grid min-w-0 gap-1">
              <div
                className={`h-1.5 rounded-full ${
                  isActive ? "bg-primary" : "bg-border"
                }`}
              />
              <div
                className={`truncate text-leasium-micro font-semibold ${
                  isActive ? "text-foreground" : "text-muted-foreground"
                }`}
                title={stage}
              >
                {stage}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MaintenanceVisibilityCard({
  request,
}: {
  request: TenantPortalRecord["maintenance_requests"][number];
}) {
  const latest = latestMaintenanceHistoryEntry(request);
  const nextStep = maintenanceNextStep(request);
  const tenantAction = maintenanceTenantAction(request);
  const evidenceCount = maintenanceEvidenceCount(request);
  const latestTimestamp = latest?.timestamp ?? request.requested_at;

  return (
    <div className="grid gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm lg:grid-cols-3">
      <div className="grid gap-1 rounded-md border border-border bg-white px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-foreground">Latest update</span>
          <StatusBadge
            tone={
              latest
                ? maintenanceTone(latest.status ?? request.status)
                : "neutral"
            }
          >
            {formatDate(latestTimestamp)}
          </StatusBadge>
        </div>
        <div className="text-muted-foreground">
          {latest ? latest.summary : "Request submitted to the property team."}
        </div>
        <div className="text-xs text-muted-foreground">
          {formatDateTime(latestTimestamp)}
        </div>
      </div>
      <div className="grid gap-1 rounded-md border border-border bg-white px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-foreground">
            What happens next
          </span>
          <StatusBadge tone={nextStep.tone}>{nextStep.label}</StatusBadge>
        </div>
        <div className="text-muted-foreground">{nextStep.detail}</div>
        <div className="text-xs text-muted-foreground">
          {evidenceCount
            ? `${evidenceCount} file${evidenceCount === 1 ? "" : "s"} attached`
            : "No files attached yet"}
        </div>
      </div>
      <div className="grid gap-1 rounded-md border border-border bg-white px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-foreground">Your action</span>
          <StatusBadge tone={tenantAction.tone}>
            {tenantAction.label}
          </StatusBadge>
        </div>
        <div className="text-muted-foreground">{tenantAction.detail}</div>
        <div className="text-xs text-muted-foreground">
          {tenantAction.timing}
        </div>
      </div>
    </div>
  );
}

function TenantDocumentSummary({
  document,
}: {
  document: TenantPortalDocumentRecord;
}) {
  return (
    <>
      <span className="grid min-w-0 gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <FileText size={15} className="shrink-0 text-primary" />
          <span className="truncate font-medium">{document.filename}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {categoryLabels[document.category]} -{" "}
          {formatBytes(document.byte_size)} - {label(document.source)} -{" "}
          {formatDateTime(document.created_at)}
        </span>
        {document.notes ? (
          <span className="text-xs text-muted-foreground">
            {document.notes}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2 justify-self-start text-xs font-semibold text-muted-foreground md:justify-self-end">
        Download
        <Download size={14} />
      </span>
    </>
  );
}

function RecentActivityPanel({
  activities,
}: {
  activities: TenantPortalActivityItem[];
}) {
  const [copyReceipt, setCopyReceipt] = useState<string | null>(null);
  const latestActivity = activities[0] ?? null;
  const activityCounts = activities.reduce(
    (counts, activity) => ({
      ...counts,
      [activity.tone]: counts[activity.tone] + 1,
    }),
    {
      neutral: 0,
      primary: 0,
      success: 0,
      warning: 0,
    } satisfies Record<TenantPortalActivityItem["tone"], number>,
  );
  const activityStats = [
    {
      label: "Needs reply",
      value: activityCounts.warning,
      tone: activityCounts.warning ? "warning" : "neutral",
    },
    {
      label: "Completed",
      value: activityCounts.success,
      tone: activityCounts.success ? "success" : "neutral",
    },
    {
      label: "Team updates",
      value: activityCounts.primary,
      tone: activityCounts.primary ? "primary" : "neutral",
    },
    {
      label: "Other",
      value: activityCounts.neutral,
      tone: "neutral",
    },
  ] satisfies Array<{
    label: string;
    value: number;
    tone: TenantPortalActivityItem["tone"];
  }>;
  const copyActivitySummary = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyReceipt("Copy unavailable in this browser.");
      return;
    }
    await navigator.clipboard.writeText(
      tenantPortalActivitySummaryText(activities),
    );
    setCopyReceipt("Activity summary copied.");
  };

  return (
    <Panel
      title="Recent Activity"
      icon={<Clock3 size={18} />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton type="button" onClick={copyActivitySummary}>
            <Copy size={15} />
            Copy summary
          </SecondaryButton>
          {latestActivity ? (
            <StatusBadge tone={latestActivity.tone}>
              Latest {formatDate(latestActivity.timestamp)}
            </StatusBadge>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-3 p-4">
        {copyReceipt ? (
          <p className="text-sm font-medium text-success">{copyReceipt}</p>
        ) : null}
        {activities.length ? (
          <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-4">
            {activityStats.map((stat) => (
              <div
                key={stat.label}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-xs font-medium text-muted-foreground">
                  {stat.label}
                </span>
                <StatusBadge tone={stat.tone}>{stat.value}</StatusBadge>
              </div>
            ))}
          </div>
        ) : null}
        {activities.map((activity) => (
          <div key={activity.key} className="grid gap-1 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{activity.title}</div>
              <StatusBadge tone={activity.tone}>
                {formatDate(activity.timestamp)}
              </StatusBadge>
            </div>
            <p className="text-muted-foreground">{activity.detail}</p>
          </div>
        ))}
        {!activities.length ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
            Activity will appear here as your portal updates.
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

type TenantPortalAccountAuthTokenGetter = () => Promise<string | null>;
type TenantPortalSavedHandler = (
  portal?: TenantPortalRecord,
) => void | Promise<void>;

function ContactDetailsPanel({
  portal,
  token,
  accountAuthToken,
  getAccountAuthToken,
  onSaved,
}: {
  portal: TenantPortalRecord;
  token: string | null;
  accountAuthToken: string | null;
  getAccountAuthToken: TenantPortalAccountAuthTokenGetter;
  onSaved: TenantPortalSavedHandler;
}) {
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeForm, setChangeForm] =
    useState<TenantPortalContactChangeRequestPayload>(() => ({
      contact_name: portal.tenant.contact_name ?? "",
      contact_email: portal.tenant.contact_email ?? "",
      contact_phone: portal.tenant.contact_phone ?? "",
      billing_email: portal.tenant.billing_email ?? "",
      notes: "",
    }));

  useEffect(() => {
    setChangeForm({
      contact_name: portal.tenant.contact_name ?? "",
      contact_email: portal.tenant.contact_email ?? "",
      contact_phone: portal.tenant.contact_phone ?? "",
      billing_email: portal.tenant.billing_email ?? "",
      notes: "",
    });
  }, [
    portal.tenant.billing_email,
    portal.tenant.contact_email,
    portal.tenant.contact_name,
    portal.tenant.contact_phone,
  ]);

  const contactRows = [
    ["Legal name", portal.tenant.legal_name],
    ["Trading name", portal.tenant.trading_name],
    ["Contact name", portal.tenant.contact_name],
    ["Email", portal.tenant.contact_email],
    ["Phone", portal.tenant.contact_phone],
    ["Billing email", portal.tenant.billing_email],
  ].filter(([, value]) => Boolean(value));
  const pendingContactRequests = portal.contact_change_requests.filter(
    (request) => request.status === "submitted",
  );
  const latestContactRequest = portal.contact_change_requests[0] ?? null;

  const contactChangeMutation = useMutation({
    mutationFn: async () => {
      if (portal.auth.mode === "tenant_portal_account") {
        const authToken = await getAccountAuthToken();
        if (!authToken) {
          throw new Error("Sign in again before submitting.");
        }
        return submitTenantPortalContactChangeRequest(changeForm, {
          authToken,
        });
      }
      return submitTenantPortalContactChangeRequest(changeForm, {
        token,
        authToken: accountAuthToken,
      });
    },
    onSuccess: (nextPortal) => {
      setChangeOpen(false);
      void onSaved(nextPortal);
    },
  });

  function setChangeField<
    K extends keyof TenantPortalContactChangeRequestPayload,
  >(field: K, value: TenantPortalContactChangeRequestPayload[K]) {
    setChangeForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <Panel
      title="Contact Details"
      icon={<UserRound size={18} />}
      actions={<StatusBadge tone="success">Confirmed</StatusBadge>}
    >
      <div className="grid gap-3 p-4 text-sm">
        <dl className="grid gap-3">
          {contactRows.map(([term, value]) => (
            <div key={term}>
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {!contactRows.length ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
            No contact details are on file yet.
          </div>
        ) : null}
        <p className="text-xs leading-5 text-muted-foreground">
          If something looks wrong, send a note to the property team before
          signing or paying anything that depends on these details.
        </p>
        {pendingContactRequests.length ? (
          <div className="grid gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">Change request in review</div>
              <StatusBadge tone="warning">Submitted</StatusBadge>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              The property team has your latest contact change request. Your
              saved details will update here once they apply it.
            </p>
            <div className="grid gap-1 text-xs">
              {pendingContactRequests[0].changes.map((change) => (
                <div key={change.field}>
                  <span className="font-medium">{change.label}</span>:{" "}
                  {String(change.after ?? "-")}
                </div>
              ))}
            </div>
          </div>
        ) : latestContactRequest?.status === "applied" ? (
          <div className="rounded-md border border-success/30 bg-success/5 p-3 text-xs text-muted-foreground">
            Last contact change applied{" "}
            {formatDateTime(latestContactRequest.applied_at)}.
          </div>
        ) : latestContactRequest?.status === "dismissed" ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Last contact change request was reviewed{" "}
            {formatDateTime(latestContactRequest.dismissed_at)} with no saved
            detail changes.
          </div>
        ) : null}
        {pendingContactRequests.length ? null : changeOpen ? (
          <form
            className="grid gap-3 rounded-md border border-border bg-muted/30 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              contactChangeMutation.mutate();
            }}
          >
            <div className="text-sm font-semibold">Request a change</div>
            <div className="grid gap-3">
              <Field label="Contact name">
                <Input
                  value={changeForm.contact_name ?? ""}
                  onChange={(event) =>
                    setChangeField("contact_name", event.target.value)
                  }
                />
              </Field>
              <Field label="Contact email">
                <Input
                  type="email"
                  value={changeForm.contact_email ?? ""}
                  onChange={(event) =>
                    setChangeField("contact_email", event.target.value)
                  }
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={changeForm.contact_phone ?? ""}
                  onChange={(event) =>
                    setChangeField("contact_phone", event.target.value)
                  }
                />
              </Field>
              <Field label="Billing email">
                <Input
                  type="email"
                  value={changeForm.billing_email ?? ""}
                  onChange={(event) =>
                    setChangeField("billing_email", event.target.value)
                  }
                />
              </Field>
              <Field label="Note for the property team">
                <Input
                  value={changeForm.notes ?? ""}
                  onChange={(event) =>
                    setChangeField("notes", event.target.value)
                  }
                />
              </Field>
            </div>
            {contactChangeMutation.error ? (
              <p className="text-sm text-danger">
                {contactChangeMutation.error.message}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <SecondaryButton
                type="button"
                onClick={() => setChangeOpen(false)}
              >
                Cancel
              </SecondaryButton>
              <Button type="submit" disabled={contactChangeMutation.isPending}>
                {contactChangeMutation.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                Send request
              </Button>
            </div>
          </form>
        ) : (
          <div className="justify-self-start">
            <SecondaryButton type="button" onClick={() => setChangeOpen(true)}>
              <PenLine size={15} />
              Request change
            </SecondaryButton>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Panel({
  title,
  icon,
  actions,
  children,
  id,
}: {
  title: string;
  icon: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 overflow-hidden rounded-md border border-border bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function PreferencesForm({
  token,
  portal,
  getAccountAuthToken,
  onSaved,
}: {
  token: string | null;
  portal: TenantPortalRecord;
  getAccountAuthToken: TenantPortalAccountAuthTokenGetter;
  onSaved: TenantPortalSavedHandler;
}) {
  const [preferences, setPreferences] =
    useState<TenantPortalNotificationPreferencesPayload>(
      portal.notification_preferences,
    );

  useEffect(() => {
    setPreferences(portal.notification_preferences);
  }, [portal.notification_preferences]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (portal.auth.mode === "tenant_portal_account") {
        const authToken = await getAccountAuthToken();
        if (!authToken) {
          throw new Error("Sign in again before saving.");
        }
        return updateTenantPortalAccountNotificationPreferences(
          preferences,
          authToken,
        );
      }
      if (token) {
        return updateTenantPortalNotificationPreferences(token, preferences);
      }
      throw new Error("Sign in to your tenant account before saving.");
    },
    onSuccess: () => {
      void onSaved();
    },
  });

  function setField<K extends keyof TenantPortalNotificationPreferencesPayload>(
    field: K,
    value: boolean,
  ) {
    setPreferences((current) => ({ ...current, [field]: value }));
  }

  const savedReceipt: TenantPortalNotificationPreferencesRecord | null =
    saveMutation.data ??
    (portal.notification_preferences.updated_at
      ? portal.notification_preferences
      : null);

  return (
    <Panel
      title="Notification Preferences"
      icon={<Bell size={18} />}
      actions={
        <StatusBadge tone="neutral">
          {label(portal.notification_preferences.preferred_channel)}
        </StatusBadge>
      }
    >
      <div className="grid gap-3 p-4">
        {[
          ["email_enabled", "Email updates"],
          ["sms_enabled", "SMS updates"],
          ["billing_email_enabled", "Billing notices"],
          ["compliance_reminders_enabled", "Compliance reminders"],
        ].map(([key, text]) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span>{text}</span>
            <input
              className="h-4 w-4 accent-primary"
              type="checkbox"
              checked={Boolean(
                preferences[
                  key as keyof TenantPortalNotificationPreferencesPayload
                ],
              )}
              onChange={(event) =>
                setField(
                  key as keyof TenantPortalNotificationPreferencesPayload,
                  event.target.checked,
                )
              }
            />
          </label>
        ))}
        {savedReceipt ? (
          <div className="rounded-md border border-success/25 bg-success/5 px-3 py-2 text-sm text-success">
            Saved {formatDateTime(savedReceipt.updated_at)}. Preferred channel:{" "}
            {label(savedReceipt.preferred_channel)}. No message sent.
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            No preference receipt yet.
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saveMutation.error ? (
            <span className="text-sm text-danger">
              {saveMutation.error.message}
            </span>
          ) : null}
          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <CheckCircle2 size={16} />
            )}
            Save
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function TenantAccountPanel({
  token,
  tokenTenantId,
  tokenTenantName,
  tokenExpiresAt,
  returnToPath = "/tenant-portal",
  onAccountPortal,
}: {
  token: string | null;
  tokenTenantId: string | null;
  tokenTenantName: string | null;
  tokenExpiresAt: string | null;
  returnToPath?: string;
  onAccountPortal: (
    portal: TenantPortalRecord | null,
    authToken: string | null,
  ) => void;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const queryClient = useQueryClient();
  const authTimedOut = useAuthLoadTimeout(isLoaded);
  const returnTo = token
    ? `/tenant-portal/${encodeURIComponent(token)}`
    : returnToPath;
  const tenantAccountUserKey = user?.id ?? "signed-out";
  const tenantAccountContextKey = tokenTenantId ?? token ?? null;
  const accountQueryEnabled =
    isLoaded &&
    isSignedIn &&
    userLoaded &&
    Boolean(user?.id) &&
    (!token || Boolean(tokenTenantId));
  const accountQuery = useQuery({
    queryKey: [
      "tenant-portal-account-session",
      tenantAccountUserKey,
      tenantAccountContextKey,
    ],
    queryFn: async () => {
      const authToken = await getToken({ skipCache: true });
      if (!authToken) {
        throw new Error("Sign in before opening the tenant account.");
      }
      const portal = await getTenantPortalAccountSession(authToken);
      return { authToken, portal };
    },
    enabled: accountQueryEnabled,
    refetchOnMount: "always",
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const accountStatusQuery = useQuery({
    queryKey: [
      "tenant-portal-account-status",
      tenantAccountUserKey,
      tenantAccountContextKey,
    ],
    queryFn: async () => {
      const authToken = await getToken({ skipCache: true });
      if (!authToken) {
        throw new Error("Sign in before checking this tenant account.");
      }
      return getTenantPortalAccountStatus(authToken);
    },
    enabled: accountQueryEnabled,
    refetchOnMount: "always",
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const accountQueryHasFreshData =
    accountQuery.isSuccess && !accountQuery.isError;
  const accountPortal = accountQueryHasFreshData
    ? accountQuery.data?.portal ?? null
    : null;
  const accountStatusQueryHasFreshData =
    accountStatusQuery.isSuccess && !accountStatusQuery.isError;
  const accountStatus = accountStatusQueryHasFreshData
    ? accountStatusQuery.data
    : null;
  const accountTenantMatches =
    Boolean(accountPortal) &&
    (!tokenTenantId || accountPortal?.tenant.id === tokenTenantId);
  const tokenExpiryCopy = tokenExpiresAt
    ? `This portal link expires ${formatDateTime(tokenExpiresAt)}.`
    : "If the original link expired or was lost, ask the property team for a fresh portal link.";

  useLayoutEffect(() => {
    if (!isLoaded || !isSignedIn || !userLoaded) {
      onAccountPortal(null, null);
      return;
    }
    if (!accountQueryHasFreshData) {
      onAccountPortal(null, null);
      return;
    }
    if (accountQuery.data && accountTenantMatches) {
      onAccountPortal(accountQuery.data.portal, accountQuery.data.authToken);
      return;
    }
    if (accountQuery.data && !accountTenantMatches) {
      onAccountPortal(null, null);
    }
  }, [
    accountQuery.data,
    accountQueryHasFreshData,
    accountTenantMatches,
    isLoaded,
    isSignedIn,
    onAccountPortal,
    userLoaded,
  ]);

  const claimMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        throw new Error(
          "Open your tenant invite link once before finishing account setup.",
        );
      }
      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Sign in before finishing tenant account setup.");
      }
      const portal = await claimTenantPortalAccount(token, authToken);
      return { authToken, portal };
    },
    onSuccess: (result) => {
      queryClient.setQueryData(
        [
          "tenant-portal-account-session",
          tenantAccountUserKey,
          tenantAccountContextKey,
        ],
        result,
      );
      onAccountPortal(result.portal, result.authToken);
      accountStatusQuery.refetch();
    },
  });

  if (!isLoaded) {
    return (
      <Panel title="Account Access" icon={<UserRound size={18} />}>
        {authTimedOut ? (
          <ClerkSessionUnavailableNotice className="m-4" />
        ) : (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin text-primary" />
            Checking sign-in.
          </div>
        )}
      </Panel>
    );
  }

  if (!isSignedIn) {
    return (
      <Panel title="Account Access" icon={<UserRound size={18} />}>
        <div className="grid gap-3 p-4 text-sm">
          <p className="text-muted-foreground">
            {token
              ? "Create or sign in to your tenant account first. Once that is done, onboarding continues inside the portal."
              : "Create or sign in to your tenant account to open your portal. If your link expired or was lost, ask the property team for a fresh one."}
          </p>
          <div className="flex flex-wrap gap-2">
            <SignUpButton mode="redirect" fallbackRedirectUrl={returnTo}>
              <Button type="button">
                <LogIn size={16} />
                Create login
              </Button>
            </SignUpButton>
            <SignInButton mode="redirect" fallbackRedirectUrl={returnTo}>
              <SecondaryButton type="button">Sign in</SecondaryButton>
            </SignInButton>
          </div>
        </div>
      </Panel>
    );
  }

  if (
    !userLoaded ||
    accountQuery.isLoading ||
    (accountQuery.isFetching && !accountQueryHasFreshData)
  ) {
    return (
      <Panel title="Account Access" icon={<UserRound size={18} />}>
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin text-primary" />
          Checking tenant account.
        </div>
      </Panel>
    );
  }

  if (accountStatus?.status === "revoked" && !accountPortal) {
    return (
      <Panel
        title="Account Access"
        icon={<UserRound size={18} />}
        actions={
          <UserButton appearance={clerkUserButtonTouchTargetAppearance} />
        }
      >
        <div className="grid gap-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="danger">Access revoked</StatusBadge>
            {accountStatus.tenant_name ? (
              <span className="text-muted-foreground">
                {accountStatus.tenant_name}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground">{accountStatus.recovery_hint}</p>
          {accountStatus.revoked_at ? (
            <p className="text-xs text-muted-foreground">
              Revoked {formatDateTime(accountStatus.revoked_at)}
            </p>
          ) : null}
          {accountStatus.recovery_at ? (
            <p className="text-xs text-muted-foreground">
              Staff recovery updated {formatDateTime(accountStatus.recovery_at)}
            </p>
          ) : null}
        </div>
      </Panel>
    );
  }

  if (accountPortal && !accountTenantMatches) {
    return (
      <Panel
        title="Account Access"
        icon={<UserRound size={18} />}
        actions={
          <UserButton appearance={clerkUserButtonTouchTargetAppearance} />
        }
      >
        <div className="grid gap-2 p-4 text-sm">
          <StatusBadge tone="warning">Different tenant</StatusBadge>
          <p className="text-muted-foreground">
            This login is already connected to another tenant portal.
          </p>
          <p className="text-muted-foreground">
            Sign out and choose the login for {tokenTenantName ?? "this tenant"}
            , or ask the property team to update this account&apos;s portal
            access.
          </p>
          <p className="text-xs text-muted-foreground">{tokenExpiryCopy}</p>
        </div>
      </Panel>
    );
  }

  if (accountPortal && accountTenantMatches) {
    const signedInEmailAddress =
      user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? null;
    return (
      <Panel
        title="Your account"
        icon={<UserRound size={18} />}
        actions={
          <UserButton appearance={clerkUserButtonTouchTargetAppearance} />
        }
      >
        <div className="grid gap-3 p-4 text-sm">
          {signedInEmailAddress ? (
            <p className="font-medium text-foreground">{signedInEmailAddress}</p>
          ) : null}
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="font-medium text-foreground">How to get back in</p>
            <p className="mt-1 leading-6 text-muted-foreground">
              Go to{" "}
              <span className="font-medium text-foreground">
                leasium.ai/tenant-portal
              </span>
              , enter your email and we&apos;ll send a 6-digit sign-in code.
              No password needed.
            </p>
          </div>
          {accountStatus?.recovery_action === "restored" &&
          accountStatus.recovery_at ? (
            <p className="text-xs text-muted-foreground">
              Access restored by the property team{" "}
              {formatDateTime(accountStatus.recovery_at)}.
            </p>
          ) : null}
        </div>
      </Panel>
    );
  }

  if (!token) {
    return (
      <Panel
        title="Account Access"
        icon={<UserRound size={18} />}
        actions={
          <UserButton appearance={clerkUserButtonTouchTargetAppearance} />
        }
      >
        <div className="grid gap-2 p-4 text-sm">
          <StatusBadge tone="warning">No portal account</StatusBadge>
          <p className="text-muted-foreground">
            Open your original tenant portal link once to connect this login.
          </p>
          <p className="text-xs text-muted-foreground">
            {accountStatus?.recovery_hint ??
              "If the link expired or was lost, ask the property team for a fresh tenant portal link."}
          </p>
          {accountStatus?.recovery_at ? (
            <p className="text-xs text-muted-foreground">
              Staff recovery updated {formatDateTime(accountStatus.recovery_at)}
            </p>
          ) : null}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Account Access"
      icon={<UserRound size={18} />}
      actions={<UserButton appearance={clerkUserButtonTouchTargetAppearance} />}
    >
      <div className="grid gap-3 p-4 text-sm">
        <p className="text-muted-foreground">
          Finish setting up this signed-in tenant account.
        </p>
        <p className="text-xs text-muted-foreground">
          {tokenExpiryCopy} Once setup is complete, you can come back through
          the tenant portal without the original invite link.
        </p>
        {claimMutation.error ? (
          <div className="grid gap-3 rounded-md border border-danger/20 bg-danger/5 p-3 text-sm">
            <span className="text-danger">
              {tenantPortalClaimErrorMessage(claimMutation.error)}
            </span>
            <span className="text-muted-foreground">
              {accountStatus?.status === "revoked"
                ? accountStatus.recovery_hint
                : "If this is the wrong tenant or the invite has expired, ask the property team to send a fresh portal link."}
            </span>
            {tenantPortalClaimNeedsDifferentLogin(claimMutation.error) ? (
              <div className="justify-self-start">
                <SignOutButton redirectUrl={returnTo}>
                  <SecondaryButton type="button">
                    <LogIn size={15} />
                    Use another login
                  </SecondaryButton>
                </SignOutButton>
              </div>
            ) : null}
          </div>
        ) : null}
        <Button
          type="button"
          onClick={() => claimMutation.mutate()}
          disabled={claimMutation.isPending}
        >
          {claimMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ShieldCheck size={16} />
          )}
          Finish account setup
        </Button>
      </div>
    </Panel>
  );
}

function readSubmittedString(
  data: Record<string, unknown> | null | undefined,
  key: string,
): string {
  if (!data) {
    return "";
  }
  const value = data[key];
  return typeof value === "string" ? value : "";
}

function readSubmittedBool(
  data: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  if (!data) {
    return false;
  }
  return data[key] === true;
}

function OnboardingPanel({
  portal,
  token,
  accountAuthToken,
  getAccountAuthToken,
  onSaved,
}: {
  portal: TenantPortalRecord;
  token: string | null;
  accountAuthToken: string | null;
  getAccountAuthToken: TenantPortalAccountAuthTokenGetter;
  onSaved: TenantPortalSavedHandler;
}) {
  const editable = portal.onboarding.status === "sent";
  const prior = portal.onboarding.submitted_data;
  const [form, setForm] = useState<TenantPortalOnboardingSubmitPayload>(() => ({
    legal_name:
      readSubmittedString(prior, "legal_name") || portal.tenant.legal_name,
    trading_name:
      readSubmittedString(prior, "trading_name") ||
      portal.tenant.trading_name ||
      "",
    abn: readSubmittedString(prior, "abn"),
    contact_name:
      readSubmittedString(prior, "contact_name") ||
      portal.tenant.contact_name ||
      "",
    contact_email:
      readSubmittedString(prior, "contact_email") ||
      portal.tenant.contact_email ||
      "",
    contact_phone:
      readSubmittedString(prior, "contact_phone") ||
      portal.tenant.contact_phone ||
      "",
    billing_email:
      readSubmittedString(prior, "billing_email") ||
      portal.tenant.billing_email ||
      "",
    insurance_confirmed: readSubmittedBool(prior, "insurance_confirmed"),
    insurance_expiry_date:
      readSubmittedString(prior, "insurance_expiry_date") || null,
    emergency_contact_name: readSubmittedString(
      prior,
      "emergency_contact_name",
    ),
    emergency_contact_phone: readSubmittedString(
      prior,
      "emergency_contact_phone",
    ),
    notes: readSubmittedString(prior, "notes"),
    accepted: false,
  }));

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (portal.auth.mode === "tenant_portal_account") {
        const authToken = await getAccountAuthToken();
        if (!authToken) {
          throw new Error("Sign in again before submitting.");
        }
        return submitTenantPortalOnboarding(form, { authToken });
      }
      return submitTenantPortalOnboarding(form, {
        token,
        authToken: accountAuthToken,
      });
    },
    onSuccess: (nextPortal) => {
      void onSaved(nextPortal);
    },
  });

  function setField<K extends keyof TenantPortalOnboardingSubmitPayload>(
    key: K,
    value: TenantPortalOnboardingSubmitPayload[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  if (!editable) {
    const statusTone =
      portal.onboarding.status === "applied"
        ? "success"
        : portal.onboarding.status === "submitted" ||
            portal.onboarding.status === "reviewed"
          ? "primary"
          : "neutral";
    const statusDetail =
      portal.onboarding.status === "submitted" ||
      portal.onboarding.status === "reviewed"
        ? `Submitted ${formatDateTime(portal.onboarding.submitted_at)}. Your property manager will review and confirm shortly.`
        : portal.onboarding.status === "applied"
          ? "Applied. Your contact details are now confirmed in Leasium."
          : `Onboarding is ${tenantOnboardingStatusLabel(portal.onboarding.status)}.`;
    return (
      <Panel
        title="Onboarding"
        icon={<UserRound size={18} />}
        actions={
          <StatusBadge tone={statusTone}>
            {tenantOnboardingStatusLabel(portal.onboarding.status)}
          </StatusBadge>
        }
      >
        <div className="grid gap-2 p-4 text-sm">
          <p className="text-muted-foreground">{statusDetail}</p>
          {prior?.legal_name ? (
            <div className="grid gap-1 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Legal name</span>{" "}
                {String(prior.legal_name)}
              </div>
              {prior.contact_email ? (
                <div>
                  <span className="font-medium text-foreground">Email</span>{" "}
                  {String(prior.contact_email)}
                </div>
              ) : null}
              {prior.contact_phone ? (
                <div>
                  <span className="font-medium text-foreground">Phone</span>{" "}
                  {String(prior.contact_phone)}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Panel>
    );
  }

  const submitError = submitMutation.error as Error | null;

  return (
    <Panel
      title="Complete your onboarding"
      icon={<UserRound size={18} />}
      actions={<StatusBadge tone="primary">Awaiting submission</StatusBadge>}
    >
      <form
        className="grid gap-4 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submitMutation.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          Confirm the core details below. Your property manager reviews this
          before any tenant record changes.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Legal name">
            <Input
              required
              value={form.legal_name}
              onChange={(event) => setField("legal_name", event.target.value)}
            />
          </Field>
          <Field label="Contact name">
            <Input
              required
              value={form.contact_name}
              onChange={(event) => setField("contact_name", event.target.value)}
            />
          </Field>
          <Field label="Contact email">
            <Input
              required
              type="email"
              value={form.contact_email}
              onChange={(event) =>
                setField("contact_email", event.target.value)
              }
            />
          </Field>
          <Field label="Contact phone">
            <Input
              required
              value={form.contact_phone ?? ""}
              onChange={(event) =>
                setField("contact_phone", event.target.value)
              }
            />
          </Field>
        </div>
        <details className="group rounded-md border border-border bg-muted/30 p-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
            Add optional details
            <ChevronDown
              size={16}
              className="shrink-0 transition group-open:rotate-180"
            />
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Trading name">
              <Input
                value={form.trading_name ?? ""}
                onChange={(event) =>
                  setField("trading_name", event.target.value)
                }
              />
            </Field>
            <Field label="ABN">
              <Input
                value={form.abn ?? ""}
                onChange={(event) => setField("abn", event.target.value)}
              />
            </Field>
            <Field label="Billing email">
              <Input
                value={form.billing_email ?? ""}
                onChange={(event) =>
                  setField("billing_email", event.target.value)
                }
              />
            </Field>
            <Field label="Insurance expiry">
              <Input
                type="date"
                value={form.insurance_expiry_date ?? ""}
                onChange={(event) =>
                  setField("insurance_expiry_date", event.target.value || null)
                }
              />
            </Field>
            <Field label="Emergency contact name">
              <Input
                value={form.emergency_contact_name ?? ""}
                onChange={(event) =>
                  setField("emergency_contact_name", event.target.value)
                }
              />
            </Field>
            <Field label="Emergency contact phone">
              <Input
                value={form.emergency_contact_phone ?? ""}
                onChange={(event) =>
                  setField("emergency_contact_phone", event.target.value)
                }
              />
            </Field>
            <Field label="Notes for your property manager">
              <textarea
                className="min-h-24 w-full resize-y rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 md:col-span-2"
                value={form.notes ?? ""}
                onChange={(event) => setField("notes", event.target.value)}
              />
            </Field>
          </div>
        </details>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={Boolean(form.insurance_confirmed)}
            onChange={(event) =>
              setField("insurance_confirmed", event.target.checked)
            }
          />
          <span>
            I confirm a current insurance policy is in place for this tenancy.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.accepted}
            onChange={(event) => setField("accepted", event.target.checked)}
          />
          <span>
            I confirm the information above is correct to the best of my
            knowledge. My property manager will review before any changes apply.
          </span>
        </label>
        {submitError ? (
          <p className="text-sm text-danger">{submitError.message}</p>
        ) : null}
        <div className="flex items-center justify-end">
          <Button
            type="submit"
            disabled={submitMutation.isPending || !form.accepted}
          >
            {submitMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            Submit for review
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function LeaseAgreementPanel({
  portal,
  token,
  accountAuthToken,
  getAccountAuthToken,
  onSaved,
}: {
  portal: TenantPortalRecord;
  token: string | null;
  accountAuthToken: string | null;
  getAccountAuthToken: TenantPortalAccountAuthTokenGetter;
  onSaved: TenantPortalSavedHandler;
}) {
  const [clauseReference, setClauseReference] = useState("");
  const [question, setQuestion] = useState("");
  const [acceptedForSigning, setAcceptedForSigning] = useState(false);
  const agreement = portal.lease_agreement;
  const questions = agreement.questions;
  const signed = agreement.status === "signed";
  const leaseDocuments = portal.compliance.uploaded_documents.filter(
    (document) =>
      document.category === "lease" &&
      (!document.tenant_onboarding_id ||
        document.tenant_onboarding_id === portal.onboarding.id) &&
      (!document.lease_id || document.lease_id === portal.lease.lease_id),
  );
  const canAskQuestion =
    !signed &&
    ["sent", "submitted", "reviewed", "applied"].includes(
      portal.onboarding.status,
    );
  const canSign = agreement.status === "ready_to_sign" && acceptedForSigning;
  const blockingCount = questions.filter(blockingLeaseQuestion).length;

  const askMutation = useMutation({
    mutationFn: async () => {
      const authToken =
        portal.auth.mode === "tenant_portal_account"
          ? await getAccountAuthToken()
          : accountAuthToken;
      if (portal.auth.mode === "tenant_portal_account" && !authToken) {
        throw new Error("Sign in again before sending your question.");
      }
      return askTenantPortalLeaseQuestion(
        {
          question,
          clause_reference: clauseReference.trim() || null,
        },
        { token, authToken },
      );
    },
    onSuccess: (nextPortal) => {
      setQuestion("");
      setClauseReference("");
      void onSaved(nextPortal);
    },
  });

  const leaseDocumentDownloadMutation = useMutation({
    mutationFn: async ({
      documentId,
      filename,
    }: {
      documentId: string;
      filename: string;
    }) => {
      const authToken =
        portal.auth.mode === "tenant_portal_account"
          ? await getAccountAuthToken()
          : accountAuthToken;
      if (!authToken) {
        throw new Error("Sign in again before downloading the lease.");
      }
      const blob = await downloadTenantPortalAccountDocument(
        documentId,
        authToken,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    },
  });

  const signMutation = useMutation({
    mutationFn: async () => {
      const authToken =
        portal.auth.mode === "tenant_portal_account"
          ? await getAccountAuthToken()
          : accountAuthToken;
      if (portal.auth.mode === "tenant_portal_account" && !authToken) {
        throw new Error("Sign in again before signing.");
      }
      return signTenantPortalLeaseAgreement({ token, authToken });
    },
    onSuccess: (nextPortal) => {
      setAcceptedForSigning(false);
      void onSaved(nextPortal);
    },
  });

  const askError = askMutation.error as Error | null;
  const signError = signMutation.error as Error | null;
  const signingDetail = signed
    ? `Signed ${formatDateTime(agreement.signed_at)}.`
    : agreement.signing_locked_reason ||
      "The lease agreement is ready to confirm.";

  return (
    <Panel
      title="Lease questions and signing"
      icon={<PenLine size={18} />}
      actions={
        <StatusBadge tone={leaseAgreementTone(agreement.status)}>
          {leaseAgreementLabel(agreement.status)}
        </StatusBadge>
      }
    >
      <div className="grid gap-4 p-4">
        <div className="grid gap-2 text-sm text-muted-foreground">
          <p>
            Ask lease questions here before signing. Signing unlocks after the
            property team reviews your details and required documents.
          </p>
          {blockingCount ? (
            <p className="font-medium text-warning-strong">
              {blockingCount} question{blockingCount === 1 ? "" : "s"} need
              attention before signing.
            </p>
          ) : null}
        </div>

        <div className="grid gap-2 rounded-md border border-border bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold">Lease document</div>
              <div className="text-muted-foreground">
                {leaseDocuments.length
                  ? "Review the lease before confirming it is signed."
                  : "The property team has not attached a lease document yet."}
              </div>
            </div>
            <StatusBadge tone={leaseDocuments.length ? "success" : "warning"}>
              {leaseDocuments.length ? "Attached" : "Waiting"}
            </StatusBadge>
          </div>
          {leaseDocuments.map((document) => (
            <div
              key={document.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{document.filename}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatBytes(document.byte_size)} - uploaded{" "}
                  {formatDate(document.created_at)}
                </div>
              </div>
              {token ? (
                <a
                  className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium transition hover:bg-muted"
                  href={tenantPortalDocumentDownloadUrl(token, document.id)}
                >
                  <Download size={15} />
                  Download
                </a>
              ) : (
                <SecondaryButton
                  type="button"
                  className="h-8"
                  disabled={leaseDocumentDownloadMutation.isPending}
                  onClick={() =>
                    leaseDocumentDownloadMutation.mutate({
                      documentId: document.id,
                      filename: document.filename,
                    })
                  }
                >
                  <Download size={15} />
                  Download
                </SecondaryButton>
              )}
            </div>
          ))}
          {leaseDocumentDownloadMutation.error ? (
            <p className="text-sm text-danger">
              {leaseDocumentDownloadMutation.error.message}
            </p>
          ) : null}
        </div>

        <form
          className="grid gap-3 rounded-md border border-border bg-muted/30 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (question.trim()) {
              askMutation.mutate();
            }
          }}
        >
          <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
            <Field label="Clause">
              <Input
                value={clauseReference}
                disabled={!canAskQuestion || askMutation.isPending}
                placeholder="Optional"
                onChange={(event) => setClauseReference(event.target.value)}
              />
            </Field>
            <Field label="Question">
              <textarea
                className="min-h-24 w-full resize-y rounded-md border border-border bg-white px-3 py-2 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
                value={question}
                disabled={!canAskQuestion || askMutation.isPending}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </Field>
          </div>
          {askError ? (
            <p className="text-sm text-danger">{askError.message}</p>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={
                !canAskQuestion || askMutation.isPending || !question.trim()
              }
            >
              {askMutation.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <MessageSquare size={16} />
              )}
              Ask question
            </Button>
          </div>
        </form>

        <div className="grid gap-2">
          {questions.map((item) => (
            <div
              key={item.id}
              className="grid gap-2 rounded-md border border-border bg-white p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">
                  {item.clause_reference || "Lease agreement"}
                </div>
                <StatusBadge tone={leaseQuestionTone(item.status)}>
                  {leaseQuestionStatusLabel(item.status)}
                </StatusBadge>
              </div>
              <p className="text-muted-foreground">{item.question}</p>
              {item.answer ? (
                <div className="rounded-md bg-primary-soft px-3 py-2 text-primary-hover">
                  {item.answer}
                </div>
              ) : null}
              <div className="text-xs text-muted-foreground">
                Asked {formatDateTime(item.asked_at)}
              </div>
            </div>
          ))}
          {!questions.length ? (
            <div className="rounded-md border border-border bg-white px-3 py-4 text-sm text-muted-foreground">
              No lease agreement questions yet.
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 rounded-md border border-border bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Signing</div>
              <div className="text-sm text-muted-foreground">
                {signingDetail}
              </div>
            </div>
            {signed ? (
              <StatusBadge tone="success">Complete</StatusBadge>
            ) : (
              <StatusBadge
                tone={
                  agreement.status === "ready_to_sign" ? "primary" : "neutral"
                }
              >
                {agreement.status === "ready_to_sign" ? "Ready" : "Locked"}
              </StatusBadge>
            )}
          </div>
          {!signed ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={acceptedForSigning}
                disabled={agreement.status !== "ready_to_sign"}
                onChange={(event) =>
                  setAcceptedForSigning(event.target.checked)
                }
              />
              <span>I have reviewed and signed the lease agreement.</span>
            </label>
          ) : null}
          {signError ? (
            <p className="text-sm text-danger">{signError.message}</p>
          ) : null}
          {!signed ? (
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={!canSign || signMutation.isPending}
                onClick={() => signMutation.mutate()}
              >
                {signMutation.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <PenLine size={16} />
                )}
                Confirm signed
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function TenantLeaseSigningView({
  portal,
  token,
  accountAuthToken,
  getAccountAuthToken,
  onSaved,
}: {
  portal: TenantPortalRecord;
  token: string | null;
  accountAuthToken: string | null;
  getAccountAuthToken: TenantPortalAccountAuthTokenGetter;
  onSaved: TenantPortalSavedHandler;
}) {
  const agreement = portal.lease_agreement;
  const applied = onboardingApplied(portal);
  const signed = agreement.status === "signed";
  const portalHref =
    portal.auth.mode === "tenant_portal_account"
      ? "/tenant-portal"
      : token
        ? `/tenant-portal/${encodeURIComponent(token)}`
        : "/tenant-portal";

  return (
    <PortalShell>
      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6">
        <section className="rounded-md border border-border bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-primary">Lease signing</p>
              <h2 className="mt-1 text-2xl font-semibold">
                Review and sign your lease
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {portal.lease.property_name} - {portal.lease.unit_label}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={applied ? "success" : "warning"}>
                {applied ? "Approved" : "In review"}
              </StatusBadge>
              <StatusBadge tone={leaseAgreementTone(agreement.status)}>
                {leaseAgreementLabel(agreement.status)}
              </StatusBadge>
            </div>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-5">
            {!applied ? (
              <Panel title="Waiting for approval" icon={<Clock3 size={18} />}>
                <div className="grid gap-2 p-4 text-sm text-muted-foreground">
                  <p>
                    The property team is still reviewing your details and
                    documents. We&apos;ll email you when the lease pack is ready
                    to sign.
                  </p>
                </div>
              </Panel>
            ) : null}
            <LeaseAgreementPanel
              portal={portal}
              token={token}
              accountAuthToken={accountAuthToken}
              getAccountAuthToken={getAccountAuthToken}
              onSaved={onSaved}
            />
          </div>

          <aside className="grid content-start gap-5">
            <Panel title="Lease Snapshot" icon={<Building2 size={18} />}>
              <dl className="grid gap-3 p-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Tenant</dt>
                  <dd className="font-medium">
                    {portal.tenant.trading_name || portal.tenant.legal_name}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Property</dt>
                  <dd className="font-medium">{portal.lease.property_name}</dd>
                  {portal.lease.property_address ? (
                    <dd className="text-muted-foreground">
                      {portal.lease.property_address}
                    </dd>
                  ) : null}
                </div>
                <div>
                  <dt className="text-muted-foreground">Unit</dt>
                  <dd className="font-medium">{portal.lease.unit_label}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Lease dates</dt>
                  <dd className="font-medium">
                    {formatDate(portal.lease.commencement_date)} to{" "}
                    {formatDate(portal.lease.expiry_date)}
                  </dd>
                </div>
              </dl>
            </Panel>

            <Panel title="What Happens Next" icon={<FileText size={18} />}>
              <div className="grid gap-2 p-4 text-sm text-muted-foreground">
                {signed ? (
                  <p>
                    Your signed lease is recorded. The full portal has payments,
                    maintenance, and documents when you need them.
                  </p>
                ) : (
                  <p>
                    Once signing is complete, your full tenant portal stays open
                    for payments, maintenance, and ongoing documents.
                  </p>
                )}
                {signed ? (
                  <a
                    className="font-medium text-primary hover:text-primary-hover"
                    href={portalHref}
                  >
                    Open full portal
                  </a>
                ) : null}
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </PortalShell>
  );
}

function TenantLoginNotConfiguredNotice() {
  return (
    <div className="grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
      <StatusBadge tone="warning">Tenant login not configured</StatusBadge>
      <p className="text-muted-foreground">
        Tenant account creation is not switched on in this environment. Ask the
        property team to enable tenant login or send a fresh invite when account
        setup is ready.
      </p>
    </div>
  );
}

function TenantLoginNotConfiguredPanel() {
  return (
    <Panel title="Account Access" icon={<UserRound size={18} />}>
      <div className="p-4">
        <TenantLoginNotConfiguredNotice />
      </div>
    </Panel>
  );
}

function TenantPortalContentWithoutAuth({
  token,
  view,
}: {
  token: string | null;
  view: "portal" | "lease";
}) {
  const invitePreviewQuery = useQuery({
    queryKey: ["tenant-portal-invite-preview", token],
    queryFn: () => getTenantPortalInvitePreview(token as string),
    enabled: Boolean(token),
    retry: false,
  });

  if (!token) {
    return (
      <PortalShell>
        <div className="mx-auto grid max-w-xl gap-5 px-5 py-8">
          <section className="rounded-md border border-border bg-white p-5">
            <p className="text-sm font-medium text-primary">Tenant Portal</p>
            <h2 className="mt-1 text-2xl font-semibold">
              {view === "lease" ? "Open your lease pack" : "Open your portal"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {view === "lease"
                ? "Sign in with your Leasium tenant account to review and sign."
                : "Sign in with your Leasium tenant account."}
            </p>
          </section>
          <TenantLoginNotConfiguredPanel />
        </div>
      </PortalShell>
    );
  }

  if (invitePreviewQuery.isLoading) {
    return (
      <TenantPortalTrustState
        loading
        title="Checking your tenant portal invite"
        detail="We are confirming this secure link before showing any tenant details."
      />
    );
  }

  if (invitePreviewQuery.error || !invitePreviewQuery.data) {
    return (
      <TenantPortalTrustState
        title="We could not verify this tenant portal link"
        detail="For your privacy, no tenant details are shown until the property team confirms the link."
        recovery="Ask the property team to resend your tenant portal invite, then open the newest link."
      />
    );
  }

  const preview = invitePreviewQuery.data;

  return (
    <PortalShell>
      <div className="mx-auto grid max-w-2xl gap-5 px-5 py-10">
        <div className="rounded-md border border-border bg-white p-6">
          <div className="flex items-center gap-3">
            <LeasiumMark />
            <div>
              <p className="text-sm font-medium text-primary">
                Tenant Account Setup
              </p>
              <h2 className="text-xl font-semibold">
                {preview.tenant_display_name}
              </h2>
            </div>
          </div>
          <dl className="mt-5 grid gap-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Property
              </dt>
              <dd className="font-medium">{preview.property_name}</dd>
              {preview.property_address ? (
                <dd className="text-muted-foreground">
                  {preview.property_address}
                </dd>
              ) : null}
            </div>
            {preview.tenant_email ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Invite email
                </dt>
                <dd>{preview.tenant_email}</dd>
              </div>
            ) : null}
            {preview.expires_at ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Invite expires
                </dt>
                <dd>{formatDateTime(preview.expires_at)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-6">
            <TenantLoginNotConfiguredNotice />
          </div>
        </div>
      </div>
    </PortalShell>
  );
}

function TenantPortalContent({
  token,
  view,
}: {
  token: string | null;
  view: "portal" | "lease";
}) {
  // Soft-switch claim gate — the token URL never exposes data without
  // a Clerk session. The token is now solely a one-time claim entry-
  // point that creates the TenantPortalAccount boundary and is then consumed.
  // The token-scoped `getTenantPortal` call is disabled entirely;
  // post-claim, every data read flows through the account-scoped
  // endpoints below.
  const {
    getToken: getClerkToken,
    isLoaded: clerkLoaded,
    isSignedIn: clerkSignedIn,
  } = useAuth();
  const { user, isLoaded: clerkUserLoaded } = useUser();
  const queryClient = useQueryClient();
  const clerkLoadTimedOut = useAuthLoadTimeout(clerkLoaded);
  const portalQuery = useQuery({
    queryKey: ["tenant-portal", token],
    queryFn: () => {
      if (!token) {
        throw new Error("Tenant portal token is required.");
      }
      return getTenantPortal(token);
    },
    enabled: false, // Token-scoped data fetch is gated; see claim flow.
  });

  // Lightweight invite preview — used only by the claim gate to show
  // "you've been invited to {property}" before the tenant signs in.
  // Never returns financial data, contact details, or documents.
  const invitePreviewQuery = useQuery({
    queryKey: ["tenant-portal-invite-preview", token],
    queryFn: () => getTenantPortalInvitePreview(token as string),
    enabled: Boolean(token),
    retry: false,
  });
  const tenantAccountUserKey = user?.id ?? "signed-out";
  const tenantAccountRouteKey = token ? `token:${token}` : "account-entry";
  const tokenTenantId = invitePreviewQuery.data?.tenant_id ?? null;
  const tenantAccountContextKey = tokenTenantId ?? token ?? null;
  const [accountPortalState, setAccountPortalState] =
    useState<TenantAccountPortalState | null>(null);
  const accountPortalStateMatches =
    accountPortalState?.userKey === tenantAccountUserKey &&
    accountPortalState.routeKey === tenantAccountRouteKey;
  const accountPortal = accountPortalStateMatches
    ? accountPortalState.portal
    : null;
  const accountAuthToken = accountPortalStateMatches
    ? accountPortalState.authToken
    : null;
  const handleAccountPortal = useCallback(
    (nextPortal: TenantPortalRecord | null, nextAuthToken: string | null) => {
      if (!nextPortal || tenantAccountUserKey === "signed-out") {
        setAccountPortalState(null);
        return;
      }
      setAccountPortalState({
        portal: nextPortal,
        authToken: nextAuthToken,
        userKey: tenantAccountUserKey,
        routeKey: tenantAccountRouteKey,
      });
    },
    [tenantAccountRouteKey, tenantAccountUserKey],
  );
  const inviteEmail = invitePreviewQuery.data?.tenant_email ?? null;
  const verifiedSignedInEmails = useMemo(() => {
    const addresses = new Set<string>();
    for (const email of user?.emailAddresses ?? []) {
      if (email.verification?.status === "verified" && email.emailAddress) {
        addresses.add(email.emailAddress);
      }
    }
    return Array.from(addresses);
  }, [user]);
  const signedInEmail =
    user?.primaryEmailAddress?.emailAddress ??
    verifiedSignedInEmails[0] ??
    null;
  const primarySignedInEmail = user?.primaryEmailAddress?.emailAddress ?? null;
  const matchingSignedInEmail = inviteEmail
    ? (verifiedSignedInEmails.find(
        (email) => normaliseEmail(email) === normaliseEmail(inviteEmail),
      ) ?? null)
    : null;
  const primarySignedInEmailMatchesInvite =
    Boolean(primarySignedInEmail) &&
    Boolean(inviteEmail) &&
    normaliseEmail(primarySignedInEmail) === normaliseEmail(inviteEmail);
  const signedInEmailMatchesInvite =
    primarySignedInEmailMatchesInvite || Boolean(matchingSignedInEmail);
  const signedInEmailMismatchesInvite =
    clerkLoaded &&
    clerkSignedIn &&
    clerkUserLoaded &&
    Boolean(inviteEmail) &&
    Boolean(signedInEmail) &&
    !signedInEmailMatchesInvite;
  const signedInEmailUnknown =
    clerkLoaded &&
    clerkSignedIn &&
    clerkUserLoaded &&
    Boolean(inviteEmail) &&
    !signedInEmail;

  // Claim gate state — when the visitor lands on /tenant-portal/{token}
  // with a Clerk session, this fires once to create the TenantPortalAccount
  // and consume the token. Subsequent visits flow straight through to
  // the account-scoped session.
  const gateClaimMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        throw new Error("Tenant portal token is required.");
      }
      await user?.reload();
      const authToken = await getClerkToken({ skipCache: true });
      if (!authToken) {
        throw new Error("Sign in before claiming the invite.");
      }
      const portal = await claimTenantPortalAccount(token, authToken);
      return { authToken, portal };
    },
    onSuccess: (result) => {
      queryClient.setQueryData(
        [
          "tenant-portal-account-session",
          tenantAccountUserKey,
          tenantAccountContextKey,
        ],
        result,
      );
      handleAccountPortal(result.portal, result.authToken);
    },
  });
  useEffect(() => {
    if (!token) return;
    if (!clerkLoaded || !clerkSignedIn) return;
    if (!clerkUserLoaded) return;
    if (signedInEmailMismatchesInvite) return;
    if (signedInEmailUnknown) return;
    if (accountPortal) return;
    if (gateClaimMutation.isPending) return;
    if (gateClaimMutation.isError) return;
    if (gateClaimMutation.isSuccess) return;
    if (!invitePreviewQuery.data) return;
    gateClaimMutation.mutate();
  }, [
    token,
    clerkLoaded,
    clerkSignedIn,
    clerkUserLoaded,
    signedInEmailMismatchesInvite,
    signedInEmailUnknown,
    accountPortal,
    gateClaimMutation,
    invitePreviewQuery.data,
  ]);
  const tokenPortal = portalQuery.data;
  const portal = accountPortal ?? tokenPortal;
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] =
    useState<DocumentCategory>("insurance");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [maintenanceTitle, setMaintenanceTitle] = useState("");
  const [maintenancePriority, setMaintenancePriority] =
    useState<MaintenancePriority>("normal");
  const [maintenanceDescription, setMaintenanceDescription] = useState("");
  const [maintenanceSourceReference, setMaintenanceSourceReference] =
    useState("");
  const [maintenancePhotoFile, setMaintenancePhotoFile] = useState<File | null>(
    null,
  );
  const [maintenancePhotoInputKey, setMaintenancePhotoInputKey] = useState(0);
  const accountScoped = portal?.auth.mode === "tenant_portal_account";

  const getFreshAccountAuthToken = useCallback(async () => {
    if (!clerkLoaded || !clerkSignedIn) {
      return null;
    }
    const authToken = await getClerkToken({ skipCache: true });
    if (authToken) {
      setAccountPortalState((current) =>
        current?.userKey === tenantAccountUserKey &&
        current.routeKey === tenantAccountRouteKey
          ? { ...current, authToken }
          : current,
      );
    }
    return authToken;
  }, [
    clerkLoaded,
    clerkSignedIn,
    getClerkToken,
    tenantAccountRouteKey,
    tenantAccountUserKey,
  ]);

  useLayoutEffect(() => {
    handleAccountPortal(null, null);
  }, [handleAccountPortal, token]);

  const refreshPortal = useCallback(
    async (nextPortal?: TenantPortalRecord) => {
      if (nextPortal) {
        handleAccountPortal(nextPortal, accountAuthToken);
        return;
      }
      if (accountPortal?.auth.mode === "tenant_portal_account") {
        const authToken = await getFreshAccountAuthToken();
        if (!authToken) {
          handleAccountPortal(null, null);
          return;
        }
        try {
          const refreshedPortal = await getTenantPortalAccountSession(authToken);
          handleAccountPortal(refreshedPortal, authToken);
          return;
        } catch {
          handleAccountPortal(null, null);
          return;
        }
      }
      await portalQuery.refetch();
    },
    [
      accountAuthToken,
      accountPortal?.auth.mode,
      getFreshAccountAuthToken,
      handleAccountPortal,
      portalQuery,
    ],
  );

  useEffect(() => {
    if (
      !portal ||
      portal.compliance.accepted_categories.includes(uploadCategory)
    ) {
      return;
    }
    setUploadCategory(portal.compliance.accepted_categories[0] ?? "insurance");
  }, [portal, uploadCategory]);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) {
        throw new Error("Choose a file first.");
      }
      if (accountScoped) {
        const authToken = await getFreshAccountAuthToken();
        if (!authToken) {
          throw new Error("Sign in again before uploading.");
        }
        return uploadTenantPortalAccountDocument({
          category: uploadCategory,
          notes: uploadNotes,
          file: uploadFile,
          authToken,
        });
      }
      if (!token) {
        throw new Error("Sign in to your tenant account before uploading.");
      }
      return uploadTenantPortalDocument({
        token,
        category: uploadCategory,
        notes: uploadNotes,
        file: uploadFile,
      });
    },
    onSuccess: () => {
      setUploadFile(null);
      setUploadNotes("");
      setUploadOpen(false);
      void refreshPortal();
    },
  });

  const maintenanceMutation = useMutation({
    mutationFn: async () => {
      const title = maintenanceTitle.trim();
      const description = maintenanceDescription.trim();
      const payload: TenantPortalMaintenanceRequestPayload = {
        title,
        description,
        priority: maintenancePriority,
        source_reference: maintenanceSourceReference.trim() || null,
      };
      if (!payload.title || !payload.description) {
        throw new Error("Add a title and details before submitting.");
      }
      const accountActionAuthToken = accountScoped
        ? await getFreshAccountAuthToken()
        : null;
      if (accountScoped && !accountActionAuthToken) {
        throw new Error("Sign in again before submitting.");
      }

      if (maintenancePhotoFile) {
        const notes = `Maintenance photo: ${title}`;
        const document =
          accountScoped && accountActionAuthToken
            ? await uploadTenantPortalAccountDocument({
                category: "other",
                notes,
                file: maintenancePhotoFile,
                authToken: accountActionAuthToken,
              })
            : token
              ? await uploadTenantPortalDocument({
                  token,
                  category: "other",
                  notes,
                  file: maintenancePhotoFile,
                })
              : null;
        if (!document) {
          throw new Error("Sign in to your tenant account before submitting.");
        }
        payload.photo_document_ids = [document.id];
      }

      if (accountScoped && accountActionAuthToken) {
        return createTenantPortalAccountMaintenanceRequest(
          payload,
          accountActionAuthToken,
        );
      }
      if (!token) {
        throw new Error("Sign in to your tenant account before submitting.");
      }
      return createTenantPortalMaintenanceRequest(token, payload);
    },
    onSuccess: () => {
      setMaintenanceTitle("");
      setMaintenancePriority("normal");
      setMaintenanceDescription("");
      setMaintenanceSourceReference("");
      setMaintenancePhotoFile(null);
      setMaintenancePhotoInputKey((current) => current + 1);
      void refreshPortal();
    },
  });

  const visibleCategories = useMemo(
    () =>
      (portal?.compliance.accepted_categories ?? []).filter(
        (category) => category !== "invoice",
      ),
    [portal?.compliance.accepted_categories],
  );
  const openMaintenanceCount = useMemo(
    () =>
      (portal?.maintenance_requests ?? []).filter(
        (request) => !["completed", "cancelled"].includes(request.status),
      ).length,
    [portal?.maintenance_requests],
  );
  const sortedMaintenanceRequests = useMemo(
    () =>
      [...(portal?.maintenance_requests ?? [])].sort((left, right) =>
        maintenanceRequestSortValue(left).localeCompare(
          maintenanceRequestSortValue(right),
        ),
      ),
    [portal?.maintenance_requests],
  );

  const documentDownloadMutation = useMutation({
    mutationFn: async ({
      documentId,
      filename,
    }: {
      documentId: string;
      filename: string;
    }) => {
      const authToken = await getFreshAccountAuthToken();
      if (!authToken) {
        throw new Error("Sign in to download this document.");
      }
      const blob = await downloadTenantPortalAccountDocument(
        documentId,
        authToken,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    },
  });

  if (!token && !portal) {
    return (
      <PortalShell>
        <div className="mx-auto grid max-w-xl gap-5 px-5 py-8">
          <section className="rounded-md border border-border bg-white p-5">
            <p className="text-sm font-medium text-primary">Tenant Portal</p>
            <h2 className="mt-1 text-2xl font-semibold">Open your portal</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in with your Leasium tenant account.
            </p>
          </section>
          <TenantAccountPanel
            token={null}
            tokenTenantId={null}
            tokenTenantName={null}
            tokenExpiresAt={null}
            returnToPath={
              view === "lease" ? "/tenant-portal/lease" : "/tenant-portal"
            }
            onAccountPortal={handleAccountPortal}
          />
        </div>
      </PortalShell>
    );
  }

  // Soft-switch claim gate. When the visitor lands on /tenant-portal/{token}
  // and there's no account-scoped portal yet, this is the *only* thing
  // they see — no rent ledger, no documents, no maintenance history.
  // It either (a) prompts Clerk sign-in/sign-up with property context,
  // (b) shows a "setting up your account…" spinner while gateClaimMutation
  // runs, (c) explains the invite has already been used, or (d)
  // surfaces a claim error with a retry path.
  if (token && !accountPortal) {
    if (invitePreviewQuery.isLoading) {
      return (
        <TenantPortalTrustState
          loading
          title="Checking your tenant portal invite"
          detail="We are confirming this secure link before showing any tenant details."
        />
      );
    }
    if (invitePreviewQuery.error || !invitePreviewQuery.data) {
      return (
        <TenantPortalTrustState
          title="We could not verify this tenant portal link"
          detail="For your privacy, no tenant details are shown until the property team confirms the link."
          recovery="Ask the property team to resend your tenant portal invite, then open the newest link."
        />
      );
    }
    const preview = invitePreviewQuery.data;
    const returnTo =
      view === "lease"
        ? `/tenant-portal/${encodeURIComponent(token)}/lease`
        : `/tenant-portal/${encodeURIComponent(token)}`;
    return (
      <PortalShell>
        <div className="mx-auto grid max-w-2xl gap-5 px-5 py-10">
          <div className="rounded-md border border-border bg-white p-6">
            <div className="flex items-center gap-3">
              <LeasiumMark />
              <div>
                <p className="text-sm font-medium text-primary">
                  Tenant Account Setup
                </p>
                <h2 className="text-xl font-semibold">
                  {preview.tenant_display_name}
                </h2>
              </div>
            </div>
            <dl className="mt-5 grid gap-2 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Property
                </dt>
                <dd className="font-medium">{preview.property_name}</dd>
                {preview.property_address ? (
                  <dd className="text-muted-foreground">
                    {preview.property_address}
                  </dd>
                ) : null}
              </div>
              {preview.tenant_email ? (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Invite email
                  </dt>
                  <dd>{preview.tenant_email}</dd>
                </div>
              ) : null}
              {preview.expires_at ? (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Invite expires
                  </dt>
                  <dd>{formatDateTime(preview.expires_at)}</dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-6 grid gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
              {!clerkLoaded ? (
                clerkLoadTimedOut ? (
                  <ClerkSessionUnavailableNotice />
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={16} className="animate-spin text-primary" />
                    Checking sign-in…
                  </div>
                )
              ) : !clerkSignedIn ? (
                <div className="grid gap-2 text-sm">
                  {!preview.claimable ? (
                    <>
                      <StatusBadge tone="warning">
                        Invite already used
                      </StatusBadge>
                      <p className="text-muted-foreground">
                        This invite link has already been claimed. Sign in with
                        the tenant account you set up earlier, or ask the
                        property team for a fresh link.
                      </p>
                    </>
                  ) : null}
                  <TenantInviteEmailCodeGate
                    claimable={preview.claimable}
                    initialEmail={preview.tenant_email}
                    tenantDisplayName={preview.tenant_display_name}
                  />
                </div>
              ) : !clerkUserLoaded ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={16} className="animate-spin text-primary" />
                  Checking signed-in account…
                </div>
              ) : signedInEmailUnknown ? (
                <div className="grid gap-3 text-sm">
                  <StatusBadge tone="warning">
                    Couldn&apos;t read this login
                  </StatusBadge>
                  <p className="text-muted-foreground">
                    Leasium could not read the email on this signed-in account.
                    Sign out, then sign in directly with{" "}
                    <span className="font-medium text-foreground">
                      {preview.tenant_email}
                    </span>
                    .
                  </p>
                  <SignOutButton redirectUrl={returnTo}>
                    <SecondaryButton type="button">
                      <LogIn size={15} />
                      Use another login
                    </SecondaryButton>
                  </SignOutButton>
                </div>
              ) : signedInEmailMismatchesInvite ? (
                <div className="grid gap-3 text-sm">
                  <StatusBadge tone="warning">Use the invite email</StatusBadge>
                  <p className="text-muted-foreground">
                    You&apos;re signed in as{" "}
                    <span className="font-medium text-foreground">
                      {signedInEmail}
                    </span>
                    , but this invite is for{" "}
                    <span className="font-medium text-foreground">
                      {preview.tenant_email}
                    </span>
                    .
                  </p>
                  <SignOutButton redirectUrl={returnTo}>
                    <SecondaryButton type="button">
                      <LogIn size={15} />
                      Use another login
                    </SecondaryButton>
                  </SignOutButton>
                </div>
              ) : gateClaimMutation.isError ? (
                (() => {
                  const needsSessionReset = tenantPortalClaimNeedsSessionReset(
                    gateClaimMutation.error,
                    signedInEmail,
                    preview.tenant_email,
                  );
                  return (
                    <div className="grid gap-3 text-sm">
                      <StatusBadge tone="danger">
                        Couldn&apos;t link this login
                      </StatusBadge>
                      <p className="text-muted-foreground">
                        {tenantPortalClaimErrorMessage(
                          gateClaimMutation.error,
                          signedInEmail,
                          preview.tenant_email,
                        )}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {needsSessionReset ? (
                          <SignOutButton redirectUrl={returnTo}>
                            <Button type="button">
                              <LogIn size={15} />
                              Reset sign-in
                            </Button>
                          </SignOutButton>
                        ) : (
                          <Button
                            type="button"
                            onClick={() => {
                              gateClaimMutation.reset();
                              if (!user) {
                                gateClaimMutation.mutate();
                                return;
                              }
                              void user.reload().finally(() => {
                                gateClaimMutation.mutate();
                              });
                            }}
                          >
                            Try again
                          </Button>
                        )}
                        {tenantPortalClaimNeedsDifferentLogin(
                          gateClaimMutation.error,
                        ) ? (
                          <SignOutButton redirectUrl={returnTo}>
                            <SecondaryButton type="button">
                              <LogIn size={15} />
                              {needsSessionReset
                                ? "Use another email"
                                : "Use another login"}
                            </SecondaryButton>
                          </SignOutButton>
                        ) : null}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={16} className="animate-spin text-primary" />
                  Setting up your account…
                </div>
              )}
            </div>
          </div>
        </div>
      </PortalShell>
    );
  }

  if (portalQuery.isLoading && !portal) {
    return (
      <TenantPortalTrustState
        loading
        title="Opening your tenant portal"
        detail="We are checking your account access before showing tenant documents, payments, or maintenance history."
      />
    );
  }

  if ((portalQuery.error && !accountPortal) || !portal) {
    return (
      <TenantPortalTrustState
        title="We could not open this tenant portal"
        detail="No tenant details were changed. Your portal may need a fresh invite or a tenant account relink."
        recovery="Ask the property team to resend your tenant portal invite, then open the newest link."
      />
    );
  }

  const detailsSubmitted = onboardingSubmitted(portal);
  const leaseAgreement = portal.lease_agreement;
  const leaseAgreementSigned = leaseAgreement.status === "signed";
  const onboardingAppliedComplete = onboardingApplied(portal);
  const fullPortalUnlocked = onboardingAppliedComplete && leaseAgreementSigned;
  const requiredDocuments = portal.compliance.items;
  const actionableDocuments = requiredDocuments.filter((item) =>
    ["missing", "expired"].includes(item.status),
  );
  const documentsRequired = requiredDocuments.length > 0;
  const documentsComplete = actionableDocuments.length === 0;
  const onboardingReviewReady = detailsSubmitted && documentsComplete;

  if (view === "lease") {
    return (
      <TenantLeaseSigningView
        portal={portal}
        token={token}
        accountAuthToken={accountAuthToken}
        getAccountAuthToken={getFreshAccountAuthToken}
        onSaved={refreshPortal}
      />
    );
  }

  if (!fullPortalUnlocked) {
    return (
      <PortalShell>
        <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6">
          <section className="rounded-md border border-border bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <p className="text-sm font-medium text-primary">
                  Tenant onboarding
                </p>
                <h2 className="mt-1 text-2xl font-semibold">
                  {onboardingAppliedComplete
                    ? "Sign your lease to finish."
                    : "Let's get your tenancy ready."}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {onboardingAppliedComplete
                    ? "Your details are approved. Review the lease pack and sign before the full portal opens."
                    : "Confirm your details and upload requested documents. The property team will email you when the lease pack is ready to sign."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone="success">Account ready</StatusBadge>
                <StatusBadge
                  tone={
                    portal.onboarding.status === "cancelled"
                      ? "danger"
                      : onboardingAppliedComplete
                        ? "success"
                        : detailsSubmitted
                          ? "warning"
                          : "primary"
                  }
                >
                  {tenantOnboardingStatusLabel(portal.onboarding.status)}
                </StatusBadge>
              </div>
            </div>
            <dl className="mt-5 grid gap-3 text-sm md:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  Tenant
                </dt>
                <dd className="mt-1 font-medium">
                  {tenantDisplayName(portal.tenant)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  Property
                </dt>
                <dd className="mt-1 font-medium">
                  {portal.lease.property_name} - {portal.lease.unit_label}
                </dd>
                {portal.lease.property_address ? (
                  <dd className="text-muted-foreground">
                    {portal.lease.property_address}
                  </dd>
                ) : null}
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  Due
                </dt>
                <dd className="mt-1 font-medium">
                  {formatDate(portal.onboarding.due_date)}
                </dd>
                {portal.onboarding.submitted_at ? (
                  <dd className="text-muted-foreground">
                    Submitted {formatDateTime(portal.onboarding.submitted_at)}
                  </dd>
                ) : null}
              </div>
            </dl>
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid gap-5">
              <OnboardingPanel
                portal={portal}
                token={token}
                accountAuthToken={accountAuthToken}
                getAccountAuthToken={getFreshAccountAuthToken}
                onSaved={refreshPortal}
              />

              <Panel
                title="Required Documents"
                icon={<UploadCloud size={18} />}
                actions={
                  <StatusBadge tone={documentsComplete ? "success" : "warning"}>
                    {!documentsRequired
                      ? "Not required"
                      : documentsComplete
                        ? "Received"
                        : "Needed"}
                  </StatusBadge>
                }
              >
                <div className="grid gap-4 p-4">
                  <p className="text-sm text-muted-foreground">
                    {documentsRequired
                      ? "Upload only the documents requested for onboarding. Your property team reviews each file before marking it complete."
                      : "No documents are required right now. You can still upload supporting files if your property team asks for them."}
                  </p>
                  <div className="grid gap-3 md:grid-cols-3">
                    {actionableDocuments.map((item) => (
                      <div
                        key={item.key}
                        className="rounded-md border border-warning/30 bg-warning/5 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 font-semibold">
                            {item.label}
                          </div>
                          <StatusBadge
                            tone={complianceTone(item.status)}
                            className="shrink-0"
                          >
                            {tenantDocStatusLabel(item.status)}
                          </StatusBadge>
                        </div>
                        <div className="mt-2 text-sm text-muted-foreground">
                          {item.document_count} file
                          {item.document_count === 1 ? "" : "s"}
                          {item.due_date
                            ? ` - ${formatDate(item.due_date)}`
                            : ""}
                        </div>
                      </div>
                    ))}
                    {!actionableDocuments.length ? (
                      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground md:col-span-3">
                        No required document checklist for this onboarding.
                      </div>
                    ) : null}
                  </div>

                  {portal.compliance.uploads_enabled ? (
                    <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3">
                      <Field label="Document">
                        <Input
                          type="file"
                          className="py-2 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-primary-hover hover:file:bg-primary/15"
                          onChange={(event) =>
                            setUploadFile(event.target.files?.[0] ?? null)
                          }
                        />
                      </Field>
                      <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                        <Field label="Type">
                          <Select
                            value={uploadCategory}
                            onChange={(event) =>
                              setUploadCategory(
                                event.target.value as DocumentCategory,
                              )
                            }
                          >
                            {visibleCategories.map((category) => (
                              <option key={category} value={category}>
                                {categoryLabels[category]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Notes">
                          <Input
                            value={uploadNotes}
                            onChange={(event) =>
                              setUploadNotes(event.target.value)
                            }
                          />
                        </Field>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {uploadMutation.error ? (
                          <span className="text-sm text-danger">
                            {uploadMutation.error.message}
                          </span>
                        ) : null}
                        <Button
                          type="button"
                          onClick={() => uploadMutation.mutate()}
                          disabled={!uploadFile || uploadMutation.isPending}
                        >
                          {uploadMutation.isPending ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <UploadCloud size={16} />
                          )}
                          Upload for review
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-2">
                    {portal.compliance.uploaded_documents.map((document) =>
                      accountScoped ? (
                        <button
                          key={document.id}
                          aria-label={`Download ${document.filename}`}
                          className="grid gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                          type="button"
                          disabled={documentDownloadMutation.isPending}
                          onClick={() =>
                            documentDownloadMutation.mutate({
                              documentId: document.id,
                              filename: document.filename,
                            })
                          }
                        >
                          <TenantDocumentSummary document={document} />
                        </button>
                      ) : token ? (
                        <a
                          key={document.id}
                          aria-label={`Download ${document.filename}`}
                          className="grid gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                          href={tenantPortalDocumentDownloadUrl(
                            token,
                            document.id,
                          )}
                        >
                          <TenantDocumentSummary document={document} />
                        </a>
                      ) : null,
                    )}
                    {documentDownloadMutation.error ? (
                      <span className="text-sm text-danger">
                        {documentDownloadMutation.error.message}
                      </span>
                    ) : null}
                    {!portal.compliance.uploaded_documents.length ? (
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                        No onboarding documents have been uploaded yet.
                      </div>
                    ) : null}
                  </div>
                </div>
              </Panel>

              <LeaseAgreementPanel
                portal={portal}
                token={token}
                accountAuthToken={accountAuthToken}
                getAccountAuthToken={getFreshAccountAuthToken}
                onSaved={refreshPortal}
              />
            </div>

            <aside className="grid content-start gap-5">
              <Panel title="Checklist" icon={<CheckCircle2 size={18} />}>
                <div className="grid gap-3 p-4">
                  <OnboardingStep
                    title="Confirm details + upload docs"
                    detail={
                      onboardingAppliedComplete
                        ? "Your details and requested documents are approved."
                        : onboardingReviewReady
                          ? "Your details and requested documents are with the property team."
                          : detailsSubmitted
                            ? "Upload the requested files so the property team can finish review."
                            : documentsRequired
                              ? "Confirm your core details, then upload requested files."
                              : "Confirm your core details for property team review."
                    }
                    state={
                      onboardingReviewReady || onboardingAppliedComplete
                        ? "complete"
                        : "current"
                    }
                  />
                  <OnboardingStep
                    title="Property team review"
                    detail={
                      onboardingAppliedComplete
                        ? "Approved. Your lease pack is ready to sign."
                        : onboardingReviewReady
                          ? "The property team checks your details and documents. We'll email you when the lease pack is ready."
                          : "Review starts after your details and requested documents are submitted."
                    }
                    state={
                      onboardingAppliedComplete
                        ? "complete"
                        : onboardingReviewReady
                          ? "current"
                          : "waiting"
                    }
                  />
                  <OnboardingStep
                    title="Sign lease"
                    detail={
                      leaseAgreementSigned
                        ? "Lease agreement signing is complete."
                        : onboardingAppliedComplete
                          ? "Review and sign the lease pack to open the full portal."
                          : "The lease pack and signature request come after property team approval."
                    }
                    state={
                      leaseAgreementSigned
                        ? "complete"
                        : onboardingAppliedComplete
                          ? "current"
                          : "locked"
                    }
                  />
                </div>
              </Panel>

              <Panel title="Lease Snapshot" icon={<Building2 size={18} />}>
                <dl className="grid gap-3 p-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Property</dt>
                    <dd className="font-medium">
                      {portal.lease.property_name}
                    </dd>
                    {portal.lease.property_address ? (
                      <dd className="text-muted-foreground">
                        {portal.lease.property_address}
                      </dd>
                    ) : null}
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Unit</dt>
                    <dd className="font-medium">{portal.lease.unit_label}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Lease dates</dt>
                    <dd className="font-medium">
                      {formatDate(portal.lease.commencement_date)} to{" "}
                      {formatDate(portal.lease.expiry_date)}
                    </dd>
                  </div>
                </dl>
              </Panel>

              <Panel title="What Happens Next" icon={<FileText size={18} />}>
                <div className="grid gap-2 p-4 text-sm text-muted-foreground">
                  <p>
                    Your property team sends the lease pack for signing and
                    confirms when the tenancy is move-in ready.
                  </p>
                  <p>
                    The full portal opens after lease signing is complete, with
                    payments, maintenance, and ongoing documents in one place.
                  </p>
                </div>
              </Panel>
            </aside>
          </div>
        </div>
      </PortalShell>
    );
  }

  const recentActivity = buildTenantPortalActivity(portal);
  const maintenanceSummary = buildMaintenanceSummary(
    portal.maintenance_requests,
  );
  const actionItems = buildTenantPortalActionItems(
    portal,
    maintenanceSummary.openCount,
  );
  const attentionItems = actionItems.filter((item) => item.tone !== "success");

  return (
    <PortalShell>
      <div className="mx-auto grid max-w-4xl gap-5 px-5 py-6">

        {/* Status hero — identity plus one clear answer to "do I need to do anything?" */}
        <section className="grid gap-4 rounded-md border border-border bg-white p-5">
          <div>
            <p className="text-sm text-muted-foreground">
              {portal.lease.property_name}
              {portal.lease.unit_label ? ` · ${portal.lease.unit_label}` : ""}
            </p>
            <h2 className="mt-0.5 text-2xl font-semibold">
              {portal.tenant.trading_name || portal.tenant.legal_name}
            </h2>
            {portal.lease.property_address ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {portal.lease.property_address}
              </p>
            ) : null}
          </div>

          {attentionItems.length === 0 ? (
            <div className="flex items-start gap-3 rounded-md border border-success/30 bg-success/5 p-3">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
              <div className="min-w-0">
                <div className="font-medium text-success">You&apos;re all set</div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Your tenancy is active and up to date — nothing needs your
                  attention right now.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
              <div className="flex items-center gap-2">
                <Clock3 size={18} className="shrink-0 text-warning" />
                <div className="font-medium text-warning">
                  {attentionItems.length === 1
                    ? "One thing to do"
                    : `${attentionItems.length} things to do`}
                </div>
              </div>
              <div className="grid gap-1.5 pl-7">
                {attentionItems.map((item) => (
                  <div key={item.key} className="min-w-0 text-sm">
                    <span className="font-medium text-foreground">
                      {item.title}
                    </span>{" "}
                    <span className="text-muted-foreground">{item.detail}</span>
                  </div>
                ))}
              </div>
              {!documentsComplete ? (
                <a
                  href="#tenant-documents"
                  className="ml-7 inline-flex min-h-9 w-fit items-center gap-2 rounded-md border border-warning/40 bg-white px-3 text-sm font-medium text-warning transition hover:bg-warning/5"
                >
                  <UploadCloud size={15} />
                  Upload documents
                </a>
              ) : null}
            </div>
          )}
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid gap-5">

            {/* Lease signing — only if not yet signed */}
            {portal.lease_agreement.status !== "signed" ? (
              <LeaseAgreementPanel
                portal={portal}
                token={token}
                accountAuthToken={accountAuthToken}
                getAccountAuthToken={getFreshAccountAuthToken}
                onSaved={refreshPortal}
              />
            ) : null}

            {/* Payments */}
            <Panel
              title="Payments"
              icon={<ReceiptText size={18} />}
              actions={
                <StatusBadge tone={paymentTone(portal.payment_summary.status)}>
                  {portal.payment_summary.status === "paid"
                    ? "All paid"
                    : portal.payment_summary.status === "overdue"
                      ? "Overdue"
                      : portal.payment_summary.status === "unpaid"
                        ? `${formatMoney(portal.payment_summary.outstanding_cents)} due`
                        : "No invoices"}
                </StatusBadge>
              }
            >
              <div className="grid gap-3 p-4">
                {portal.invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate font-semibold">
                          {invoice.invoice_number ?? invoice.title}
                        </div>
                        <StatusBadge
                          tone={
                            invoice.outstanding_cents ? "warning" : "success"
                          }
                        >
                          {label(invoice.payment_status)}
                        </StatusBadge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Due {formatDate(invoice.due_date)} — Total{" "}
                        {formatMoney(invoice.total_cents, invoice.currency)}
                      </div>
                      {invoice.payment_reference ? (
                        <div className="mt-1 text-sm text-muted-foreground">
                          Pay reference:{" "}
                          <span className="font-medium text-foreground">
                            {invoice.payment_reference}
                          </span>
                        </div>
                      ) : null}
                      {invoice.invoice_number ? (
                        <div className="mt-1 text-sm">{invoice.title}</div>
                      ) : null}
                      {invoice.lines.length ? (
                        <div className="mt-3 grid gap-1 text-sm">
                          {invoice.lines.map((line) => (
                            <div
                              key={line.id}
                              className="flex items-center justify-between gap-3"
                            >
                              <span className="truncate">
                                {line.description}
                              </span>
                              <span className="shrink-0">
                                {formatMoney(
                                  line.amount_cents + line.gst_cents,
                                  line.currency,
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="grid content-start justify-items-end gap-2 text-sm">
                      <div className="font-semibold">
                        {formatMoney(
                          invoice.outstanding_cents,
                          invoice.currency,
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatMoney(invoice.paid_cents, invoice.currency)} paid
                      </div>
                      {invoice.pdf_document_id && accountScoped ? (
                        <button
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-semibold transition duration-200 ease-leasium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                          type="button"
                          disabled={documentDownloadMutation.isPending}
                          onClick={() =>
                            documentDownloadMutation.mutate({
                              documentId: invoice.pdf_document_id ?? "",
                              filename: `${invoice.invoice_number ?? invoice.title}.pdf`,
                            })
                          }
                        >
                          <Download size={15} />
                          PDF
                        </button>
                      ) : invoice.pdf_document_id && token ? (
                        <a
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-semibold transition duration-200 ease-leasium hover:bg-muted"
                          href={tenantPortalDocumentDownloadUrl(
                            token,
                            invoice.pdf_document_id,
                          )}
                        >
                          <Download size={15} />
                          PDF
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
                {!portal.invoices.length ? (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
                    Nothing due right now. Anything to pay will appear here,
                    with how to pay it.
                  </div>
                ) : null}
              </div>
            </Panel>

            {portal.how_to_pay ? (
              <Panel title="How to pay" icon={<ReceiptText size={18} />}>
                <div className="grid gap-3 p-4 text-sm">
                  {portal.how_to_pay.bsb &&
                  portal.how_to_pay.account_number ? (
                    <div className="grid gap-1 rounded-md border border-border p-3">
                      <div className="font-semibold">Bank transfer (EFT)</div>
                      {portal.how_to_pay.account_name ? (
                        <div>
                          Account name: {portal.how_to_pay.account_name}
                        </div>
                      ) : null}
                      <div>BSB: {portal.how_to_pay.bsb}</div>
                      <div>
                        Account: {portal.how_to_pay.account_number}
                      </div>
                    </div>
                  ) : null}
                  {portal.how_to_pay.payid ? (
                    <div className="grid gap-1 rounded-md border border-border p-3">
                      <div className="font-semibold">PayID</div>
                      <div>{portal.how_to_pay.payid}</div>
                      {portal.how_to_pay.payid_name ? (
                        <div className="text-muted-foreground">
                          Registered to {portal.how_to_pay.payid_name}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {portal.how_to_pay.bpay_biller_code ? (
                    <div className="grid gap-1 rounded-md border border-border p-3">
                      <div className="font-semibold">BPAY</div>
                      <div>
                        Biller code: {portal.how_to_pay.bpay_biller_code}
                      </div>
                    </div>
                  ) : null}
                  {portal.how_to_pay.instructions ? (
                    <p className="text-muted-foreground">
                      {portal.how_to_pay.instructions}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Quote your invoice reference when paying. Leasium does
                    not process payments.
                  </p>
                </div>
              </Panel>
            ) : null}

            {/* Maintenance */}
            <Panel
              title="Maintenance"
              icon={<Wrench size={18} />}
              actions={
                openMaintenanceCount ? (
                  <StatusBadge tone="primary">
                    {openMaintenanceCount} open
                  </StatusBadge>
                ) : undefined
              }
            >
              <div className="grid gap-4 p-4">
                <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                    <Field label="Request title">
                      <Input
                        value={maintenanceTitle}
                        onChange={(event) =>
                          setMaintenanceTitle(event.target.value)
                        }
                        placeholder="Air conditioning fault"
                      />
                    </Field>
                    <Field label="Priority">
                      <Select
                        value={maintenancePriority}
                        onChange={(event) =>
                          setMaintenancePriority(
                            event.target.value as MaintenancePriority,
                          )
                        }
                      >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Details">
                    <textarea
                      className="min-h-28 w-full resize-y rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
                      value={maintenanceDescription}
                      onChange={(event) =>
                        setMaintenanceDescription(event.target.value)
                      }
                      placeholder="What is happening, where is it, and when did it start?"
                    />
                  </Field>
                  <Field label="Location or reference">
                    <Input
                      value={maintenanceSourceReference}
                      onChange={(event) =>
                        setMaintenanceSourceReference(event.target.value)
                      }
                      placeholder="e.g. bathroom, front entry, invoice ref…"
                    />
                  </Field>
                  <Field label="Photo">
                    <div className="grid gap-2">
                      <Input
                        key={maintenancePhotoInputKey}
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          setMaintenancePhotoFile(
                            event.target.files?.[0] ?? null,
                          )
                        }
                      />
                      {maintenancePhotoFile ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <ImagePlus
                              size={15}
                              className="shrink-0 text-primary"
                            />
                            <span className="truncate">
                              {maintenancePhotoFile.name}
                            </span>
                          </span>
                          <SecondaryButton
                            type="button"
                            onClick={() => {
                              setMaintenancePhotoFile(null);
                              setMaintenancePhotoInputKey(
                                (current) => current + 1,
                              );
                            }}
                          >
                            <X size={15} />
                            Clear
                          </SecondaryButton>
                        </div>
                      ) : null}
                    </div>
                  </Field>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {maintenanceMutation.error ? (
                      <span className="text-sm text-danger">
                        {maintenanceMutation.error.message}
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      onClick={() => maintenanceMutation.mutate()}
                      disabled={maintenanceMutation.isPending}
                    >
                      {maintenanceMutation.isPending ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Send size={16} />
                      )}
                      Submit request
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  {sortedMaintenanceRequests.map((request) => (
                    <div
                      key={request.id}
                      className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate font-semibold">
                            {request.title}
                          </div>
                          <StatusBadge tone={maintenanceTone(request.status)}>
                            {label(request.status)}
                          </StatusBadge>
                          <StatusBadge tone={priorityTone(request.priority)}>
                            {label(request.priority)}
                          </StatusBadge>
                        </div>
                        {request.description ? (
                          <div className="mt-2 text-sm text-muted-foreground">
                            {request.description}
                          </div>
                        ) : null}
                        <div className="mt-2">
                          <MaintenanceStatusTimeline request={request} />
                        </div>
                        {request.history.length ? (
                          <div className="mt-3 grid gap-2 rounded-md border border-border bg-muted/30 p-2">
                            {request.history.map((entry, index) => (
                              <div
                                key={`${request.id}-${entry.event}-${entry.timestamp}-${index}`}
                                className="grid gap-1 text-xs"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold">
                                    {maintenanceEventLabel(entry.event)}
                                  </span>
                                  {entry.status ? (
                                    <StatusBadge
                                      tone={maintenanceTone(entry.status)}
                                    >
                                      {label(entry.status)}
                                    </StatusBadge>
                                  ) : null}
                                  <span className="text-muted-foreground">
                                    {formatDateTime(entry.timestamp)}
                                  </span>
                                </div>
                                <div className="text-muted-foreground">
                                  {entry.summary}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="grid content-start justify-items-end gap-1 text-xs text-muted-foreground">
                        <span>
                          Submitted {formatDateTime(request.requested_at)}
                        </span>
                        {request.completed_at ? (
                          <span>
                            Completed {formatDateTime(request.completed_at)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {!sortedMaintenanceRequests.length ? (
                    <div className="rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                      No open requests. Report an issue above and we&apos;ll
                      keep you posted on its status.
                    </div>
                  ) : null}
                </div>
              </div>
            </Panel>

            {/* Documents */}
            <Panel
              id="tenant-documents"
              title="Documents"
              icon={<FileText size={18} />}
              actions={
                !documentsComplete ? (
                  <StatusBadge tone="warning">
                    {actionableDocuments.length} to upload
                  </StatusBadge>
                ) : undefined
              }
            >
              <div className="grid gap-4 p-4">
                {requiredDocuments.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    {requiredDocuments.map((item) => (
                      <div
                        key={item.key}
                        className={`rounded-md border p-3 ${
                          ["missing", "expired"].includes(item.status)
                            ? "border-warning/30 bg-warning/5"
                            : "border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 font-semibold">
                            {item.label}
                          </div>
                          <StatusBadge
                            tone={complianceTone(item.status)}
                            className="shrink-0"
                          >
                            {tenantDocStatusLabel(item.status)}
                          </StatusBadge>
                        </div>
                        <div className="mt-2 text-sm text-muted-foreground">
                          {item.document_count} file
                          {item.document_count === 1 ? "" : "s"}
                          {item.due_date
                            ? ` · expires ${formatDate(item.due_date)}`
                            : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {uploadOpen ? (
                  <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)]">
                      <Field label="File">
                        <Input
                          type="file"
                          className="py-2 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-primary-hover hover:file:bg-primary/15"
                          onChange={(event) =>
                            setUploadFile(event.target.files?.[0] ?? null)
                          }
                        />
                      </Field>
                      <Field label="Type">
                        <Select
                          value={uploadCategory}
                          onChange={(event) =>
                            setUploadCategory(
                              event.target.value as DocumentCategory,
                            )
                          }
                        >
                          {visibleCategories.map((category) => (
                            <option key={category} value={category}>
                              {categoryLabels[category]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Notes">
                        <Input
                          value={uploadNotes}
                          onChange={(event) =>
                            setUploadNotes(event.target.value)
                          }
                        />
                      </Field>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {uploadMutation.error ? (
                        <span className="text-sm text-danger">
                          {uploadMutation.error.message}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setUploadOpen(false)}
                        className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-muted-foreground transition hover:text-foreground"
                      >
                        Cancel
                      </button>
                      <Button
                        type="button"
                        onClick={() => uploadMutation.mutate()}
                        disabled={!uploadFile || uploadMutation.isPending}
                      >
                        {uploadMutation.isPending ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <UploadCloud size={16} />
                        )}
                        Upload
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setUploadOpen(true)}
                    className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-medium text-foreground transition duration-200 ease-leasium hover:bg-muted"
                  >
                    <UploadCloud size={16} />
                    Upload a document
                  </button>
                )}

                <div className="grid gap-2">
                  {portal.compliance.uploaded_documents.map((document) =>
                    accountScoped ? (
                      <button
                        key={document.id}
                        aria-label={`Download ${document.filename}`}
                        className="grid gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                        type="button"
                        disabled={documentDownloadMutation.isPending}
                        onClick={() =>
                          documentDownloadMutation.mutate({
                            documentId: document.id,
                            filename: document.filename,
                          })
                        }
                      >
                        <TenantDocumentSummary document={document} />
                      </button>
                    ) : token ? (
                      <a
                        key={document.id}
                        aria-label={`Download ${document.filename}`}
                        className="grid gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                        href={tenantPortalDocumentDownloadUrl(
                          token,
                          document.id,
                        )}
                      >
                        <TenantDocumentSummary document={document} />
                      </a>
                    ) : null,
                  )}
                  {documentDownloadMutation.error ? (
                    <span className="text-sm text-danger">
                      {documentDownloadMutation.error.message}
                    </span>
                  ) : null}
                  {!portal.compliance.uploaded_documents.length ? (
                    <div className="rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                      No documents on file yet.
                    </div>
                  ) : null}
                </div>
              </div>
            </Panel>
          </div>

          <aside className="grid content-start gap-5">
            {/* Account — with email OTP login explanation */}
            <TenantAccountPanel
              token={token}
              tokenTenantId={tokenTenantId}
              tokenTenantName={
                invitePreviewQuery.data?.tenant_display_name ??
                (tokenPortal ? tenantDisplayName(tokenPortal.tenant) : null)
              }
              tokenExpiresAt={
                invitePreviewQuery.data?.expires_at ??
                tokenPortal?.onboarding.expires_at ??
                null
              }
              returnToPath="/tenant-portal"
              onAccountPortal={handleAccountPortal}
            />

            {/* Lease details */}
            <Panel title="Your lease" icon={<Building2 size={18} />}>
              <dl className="grid gap-3 p-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Property</dt>
                  <dd className="font-medium">
                    {portal.lease.property_name}
                  </dd>
                  {portal.lease.property_address ? (
                    <dd className="text-muted-foreground">
                      {portal.lease.property_address}
                    </dd>
                  ) : null}
                </div>
                <div>
                  <dt className="text-muted-foreground">Unit</dt>
                  <dd className="font-medium">{portal.lease.unit_label}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Lease period</dt>
                  <dd className="font-medium">
                    {formatDate(portal.lease.commencement_date)} to{" "}
                    {formatDate(portal.lease.expiry_date)}
                  </dd>
                </div>
                {portal.lease.next_review_date ? (
                  <div>
                    <dt className="text-muted-foreground">Next review</dt>
                    <dd className="font-medium">
                      {formatDate(portal.lease.next_review_date)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </Panel>

            {/* Contact details */}
            <ContactDetailsPanel
              portal={portal}
              token={token}
              accountAuthToken={
                portal.auth.mode === "tenant_portal_account"
                  ? accountAuthToken
                  : null
              }
              getAccountAuthToken={getFreshAccountAuthToken}
              onSaved={refreshPortal}
            />

            {/* Notification preferences */}
            <PreferencesForm
              token={token}
              portal={portal}
              getAccountAuthToken={getFreshAccountAuthToken}
              onSaved={refreshPortal}
            />
          </aside>
        </div>
      </div>
    </PortalShell>
  );
}
