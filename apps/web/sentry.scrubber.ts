import type { init } from "@sentry/nextjs";

type SentryOptions = NonNullable<Parameters<typeof init>[0]>;
type SentryBeforeSend = NonNullable<SentryOptions["beforeSend"]>;
type SentryErrorEvent = Parameters<SentryBeforeSend>[0];

const FILTERED = "[Filtered]";

const sensitiveExactKeys = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-api-token",
  "api_key",
  "api_token",
  "access_token",
  "refresh_token",
  "id_token",
  "password",
  "secret",
  "token",
]);

const sensitiveKeyParts = [
  "abn",
  "account",
  "bank",
  "billing_email",
  "contact_email",
  "email",
  "name",
  "owner",
  "phone",
  "recipient",
  "tenant",
  "xero",
  "basiq",
  "sendgrid",
  "twilio",
];

function isSensitiveKey(key: string) {
  const normalized = key.replace(/-/g, "_").toLowerCase();
  return (
    sensitiveExactKeys.has(normalized) ||
    sensitiveKeyParts.some((part) => normalized.includes(part))
  );
}

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      isSensitiveKey(key) ? FILTERED : scrubValue(child),
    ]),
  );
}

export const scrubSentryEvent: SentryBeforeSend = (event) => {
  const scrubbed = scrubValue(event) as SentryErrorEvent;
  if (scrubbed.user && typeof scrubbed.user === "object") {
    scrubbed.user = scrubbed.user.id ? { id: scrubbed.user.id } : {};
  }
  return scrubbed;
};
