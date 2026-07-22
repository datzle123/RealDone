export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, retry: number) => void;
}

export async function withRetry<T>(task: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const baseDelayMs = options.baseDelayMs ?? 120;
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= options.retries || (options.shouldRetry && !options.shouldRetry(error))) throw error;
      options.onRetry?.(error, attempt + 1);
      const delay = Math.min(baseDelayMs * 2 ** attempt, 1_500);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export function isTransientBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|net::ERR_|target closed|execution context was destroyed|frame was detached|temporarily unavailable/i.test(message);
}
