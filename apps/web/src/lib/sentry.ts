import * as Sentry from "@sentry/react";

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE ?? "development",
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    beforeSend(event) {
      // Strip sensitive query params from URLs
      if (event.request?.url) {
        try {
          const url = new URL(event.request.url);
          url.searchParams.delete("token");
          url.searchParams.delete("key");
          event.request.url = url.toString();
        } catch {
          // Invalid URL — leave as-is
        }
      }
      return event;
    },
  });
}
