/**
 * Retry an async function with exponential backoff.
 * Returns the result of the first successful call, or throws after all retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const { maxRetries = 2, baseDelayMs = 1000, signal } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && !signal?.aborted) {
        const delay = baseDelayMs * 2 ** attempt;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      }
    }
  }

  throw lastError;
}
