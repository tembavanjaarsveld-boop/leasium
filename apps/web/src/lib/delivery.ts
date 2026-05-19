import { OnboardingDeliveryData } from "@/lib/api";

type Tone = "neutral" | "success" | "warning" | "danger" | "primary";

function channels(data: OnboardingDeliveryData | null | undefined) {
  return Object.values(data?.channels ?? {}).filter(Boolean);
}

function channelLabel(channel: string | undefined) {
  return channel === "sms" ? "SMS" : "Email";
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

export function onboardingDeliveryTone(
  data: OnboardingDeliveryData | null | undefined,
): Tone {
  const rows = channels(data);
  if (rows.some((row) => row.status === "failed")) {
    return "danger";
  }
  if (rows.some((row) => row.status === "queued")) {
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
    return "Not sent";
  }
  const failed = rows.filter((row) => row.status === "failed");
  if (failed.length) {
    return "Could not send";
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
  const skipped = rows
    .filter((row) => row.status === "skipped")
    .map((row) => `${channelLabel(row.channel)}: ${humanError(row.error, row.channel)}`);
  if (skipped.length) {
    return skipped.join(" / ");
  }
  if (rows.some((row) => row.status === "queued")) {
    return "Queued through Twilio. No profile details change until review.";
  }
  return "Delivery has not been attempted yet.";
}
