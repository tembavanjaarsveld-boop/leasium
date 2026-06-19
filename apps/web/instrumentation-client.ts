import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "./sentry.scrubber";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
      process.env.NEXT_PUBLIC_VERCEL_ENV ??
      process.env.NODE_ENV,
    beforeSend: scrubSentryEvent,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
