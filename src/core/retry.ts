export type RetryDecision = {
  retry: boolean;
  reason?: string;
};

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean | RetryDecision;
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    error: unknown;
    reason?: string;
  }) => void;
}

function resolveDecision(
  decision: boolean | RetryDecision | undefined,
): RetryDecision {
  if (typeof decision === 'boolean') return { retry: decision };
  if (decision && typeof decision === 'object' && 'retry' in decision) {
    return decision;
  }
  return { retry: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterRatio: number,
): number {
  const expo = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(maxDelayMs, expo);
  const jitter = capped * jitterRatio;
  const min = Math.max(0, capped - jitter);
  const max = capped + jitter;
  return Math.round(min + Math.random() * (max - min));
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const jitterRatio = options.jitterRatio ?? 0.2;

  let lastError: unknown;

  for (let attempt = 1; attempt <= options.retries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt >= options.retries + 1;
      if (isLastAttempt) break;

      const decision = resolveDecision(options.shouldRetry?.(error, attempt));
      if (!decision.retry) break;

      const delayMs = computeDelayMs(
        attempt,
        options.baseDelayMs,
        maxDelayMs,
        jitterRatio,
      );
      options.onRetry?.({
        attempt,
        delayMs,
        error,
        reason: decision.reason,
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

export function isProbablyTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isProbablyTransientErrorMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('network') ||
    m.includes('econnreset') ||
    m.includes('connection reset') ||
    m.includes('connection refused') ||
    m.includes('temporary') ||
    m.includes('unavailable')
  );
}

export function shouldRetryUnknownAsTransient(error: unknown): RetryDecision {
  const message = error instanceof Error ? error.message : String(error);
  if (isProbablyTransientErrorMessage(message)) {
    return { retry: true, reason: message };
  }
  return { retry: false, reason: message };
}
