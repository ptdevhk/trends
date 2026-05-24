/**
 * Lightweight structured logger for API routes.
 *
 * Drop-in replacement for console.error that adds route context and
 * structured error metadata. Can be swapped for pino/winston later
 * without changing call sites.
 */

type LogContext = {
  route?: string;
  [key: string]: unknown;
};

function formatTimestamp(): string {
  return new Date().toISOString();
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { value: String(error) };
}

export const logger = {
  error(message: string, error: unknown, context?: LogContext): void {
    const entry = {
      level: "error",
      timestamp: formatTimestamp(),
      message,
      ...context,
      error: serializeError(error),
    };
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  },

  warn(message: string, context?: LogContext): void {
    const entry = {
      level: "warn",
      timestamp: formatTimestamp(),
      message,
      ...context,
    };
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  },

  info(message: string, context?: LogContext): void {
    const entry = {
      level: "info",
      timestamp: formatTimestamp(),
      message,
      ...context,
    };
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  },
};
