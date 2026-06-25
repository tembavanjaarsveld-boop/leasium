import { OnboardingDeliveryData, OnboardingReminderStep } from "@/lib/api";

type Tone = "neutral" | "success" | "warning" | "danger" | "primary";

function channels(data: OnboardingDeliveryData | null | undefined) {
  return Object.values(data?.channels ?? {}).filter(Boolean);
}

function channelLabel(channel: string | undefined) {
  return channel === "sms" ? "SMS" : "Email";
}

function formatShortDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function humanError(error: string | null | undefined, channel: string | undefined) {
  if (!error) {
    return "Unavailable";
  }
  if (/no email recipient/i.test(error)) {
    return "No email address recorded.";
  }
  if (/no sms recipient/i.test(error)) {
    return "No mobile number recorded.";
  }
  if (/sendgrid is not configured/i.test(error) || /email disabled/i.test(error)) {
    return "Email unavailable.";
  }
  if (/twilio messaging is not configured/i.test(error) || /sms disabled/i.test(error)) {
    return "SMS unavailable.";
  }
  if (/e\.164/i.test(error)) {
    return "Check the mobile number format.";
  }
  return channel === "sms"
    ? "Check the mobile number, then retry."
    : "Check the email address, then retry.";
}

function signedLeaseAgreement(data: OnboardingDeliveryData | null | undefined) {
  const agreement = data?.lease_agreement;
  return agreement?.status === "signed" ? agreement : null;
}

function signedViaLabel(provider: string | null | undefined) {
  if (provider === "opensign") {
    return "Signed via OpenSign";
  }
  if (provider === "tenant_upload") {
    return "Signed via tenant upload";
  }
  return "Signed";
}

export function onboardingDeliveryTone(
  data: OnboardingDeliveryData | null | undefined,
): Tone {
  const rows = channels(data);
  if (!rows.length && signedLeaseAgreement(data)) {
    return "success";
  }
  if (rows.some((row) => row.status === "failed")) {
    return "danger";
  }
  if (rows.some((row) => row.status === "attention")) {
    return "warning";
  }
  if (rows.some((row) => row.status === "delivered" || row.status === "opened")) {
    return "success";
  }
  if (rows.some((row) => row.status === "queued" || row.status === "sent")) {
    return "primary";
  }
  if (rows.some((row) => row.status === "skipped")) {
    return "neutral";
  }
  return "neutral";
}

export function onboardingDeliveryLabel(
  data: OnboardingDeliveryData | null | undefined,
) {
  const rows = channels(data);
  if (!rows.length) {
    const signed = signedLeaseAgreement(data);
    return signed ? signedViaLabel(signed.signing_provider) : "Not sent";
  }
  const failed = rows.filter((row) => row.status === "failed");
  if (failed.length) {
    return onboardingNeedsContactFix(data) ? "Contact issue" : "Delivery failed";
  }
  if (rows.some((row) => row.status === "attention")) {
    return "Needs attention";
  }
  if (rows.some((row) => row.status === "opened")) {
    return "Opened";
  }
  if (rows.some((row) => row.status === "delivered")) {
    return "Delivered";
  }
  if (rows.some((row) => row.status === "sent")) {
    return "Sent";
  }
  const queued = rows.filter((row) => row.status === "queued");
  if (queued.length) {
    return `${queued.map((row) => channelLabel(row.channel)).join(" + ")} queued`;
  }
  if (
    rows.length &&
    rows.every((row) => /no .* recipient/i.test(row.error ?? ""))
  ) {
    return "No contact";
  }
  return "Not configured";
}

export function onboardingDeliveryDetail(
  data: OnboardingDeliveryData | null | undefined,
) {
  const rows = channels(data);
  const failed = rows.find((row) => row.status === "failed");
  if (failed) {
    return humanError(failed.error, failed.channel);
  }
  const attention = rows.find((row) => row.status === "attention");
  if (attention) {
    return "Provider has not confirmed delivery yet.";
  }
  const opened = rows.find((row) => row.status === "opened");
  if (opened) {
    return `${channelLabel(opened.channel)} opened by tenant.`;
  }
  const delivered = rows.find((row) => row.status === "delivered");
  if (delivered) {
    return `${channelLabel(delivered.channel)} delivered.`;
  }
  const sent = rows.find((row) => row.status === "sent");
  if (sent) {
    return `${channelLabel(sent.channel)} sent.`;
  }
  const skipped = rows
    .filter((row) => row.status === "skipped")
    .map((row) => `${channelLabel(row.channel)}: ${humanError(row.error, row.channel)}`);
  if (skipped.length) {
    return skipped.join(" / ");
  }
  if (rows.some((row) => row.status === "queued")) {
    return "Queued through Twilio. No profile details change until review.";
  }
  const signed = signedLeaseAgreement(data);
  if (signed && !rows.length) {
    return signed.signing_provider === "opensign"
      ? "Lease pack was completed through OpenSign; no email delivery was needed."
      : "Lease agreement is signed; no email delivery was needed.";
  }
  return "Delivery has not been attempted yet.";
}

export function onboardingNeedsContactFix(
  data: OnboardingDeliveryData | null | undefined,
) {
  return channels(data).some((row) => {
    const error = row.error ?? "";
    return (
      row.status === "failed" ||
      /no .* recipient/i.test(error) ||
      /e\.164/i.test(error)
    );
  });
}

export function onboardingReminderLabel(
  data: OnboardingDeliveryData | null | undefined,
) {
  const reminders = data?.reminders;
  if (!reminders) {
    return "No reminders scheduled";
  }
  if (reminders.completed_at) {
    return "Reminders complete";
  }
  if (reminders.paused) {
    return "Reminder paused";
  }
  const nextDate = formatShortDate(reminders.next_reminder_at);
  return nextDate ? `Next reminder ${nextDate}` : "No reminders scheduled";
}

export function onboardingReminderTone(
  data: OnboardingDeliveryData | null | undefined,
): Tone {
  const reminders = data?.reminders;
  if (!reminders || reminders.completed_at) {
    return "neutral";
  }
  if (reminders.paused) {
    return "warning";
  }
  return reminders.next_reminder_at ? "primary" : "neutral";
}

export function onboardingReminderSteps(
  data: OnboardingDeliveryData | null | undefined,
): OnboardingReminderStep[] {
  return data?.reminders?.schedule ?? [];
}
