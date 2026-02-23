import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retry, isProbablyTransientHttpStatus, shouldRetryUnknownAsTransient } from './retry';

describe('retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve on first attempt when fn succeeds', async () => {
    const fn = vi.fn(async () => 'ok');

    const result = await retry(async () => fn(), {
      retries: 2,
      baseDelayMs: 10,
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry and eventually succeed', async () => {
    const fn = vi
      .fn<[], Promise<string>>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('ok');

    const promise = retry(async () => fn(), {
      retries: 3,
      baseDelayMs: 10,
      maxDelayMs: 10,
      jitterRatio: 0,
      shouldRetry: (error) => shouldRetryUnknownAsTransient(error),
    });

    await vi.advanceTimersByTimeAsync(30);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should stop retrying when shouldRetry returns false', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fatal');
    });

    const promise = retry(async () => fn(), {
      retries: 5,
      baseDelayMs: 10,
      maxDelayMs: 10,
      jitterRatio: 0,
      shouldRetry: () => false,
    });

    await expect(promise).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should call onRetry with attempt + delay', async () => {
    const fn = vi
      .fn<[], Promise<string>>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('ok');

    const onRetry = vi.fn();

    const promise = retry(async () => fn(), {
      retries: 2,
      baseDelayMs: 10,
      maxDelayMs: 10,
      jitterRatio: 0,
      shouldRetry: () => true,
      onRetry,
    });

    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toBe('ok');

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        attempt: 1,
        delayMs: 10,
      }),
    );
  });
});

describe('retry helpers', () => {
  it('isProbablyTransientHttpStatus should flag transient statuses', () => {
    expect(isProbablyTransientHttpStatus(408)).toBe(true);
    expect(isProbablyTransientHttpStatus(429)).toBe(true);
    expect(isProbablyTransientHttpStatus(500)).toBe(true);
    expect(isProbablyTransientHttpStatus(503)).toBe(true);
    expect(isProbablyTransientHttpStatus(404)).toBe(false);
    expect(isProbablyTransientHttpStatus(400)).toBe(false);
  });

  it('shouldRetryUnknownAsTransient should not retry non-transient errors', () => {
    expect(shouldRetryUnknownAsTransient(new Error('bad request')).retry).toBe(
      false,
    );
  });

  it('shouldRetryUnknownAsTransient should retry transient errors', () => {
    expect(
      shouldRetryUnknownAsTransient(new Error('network timeout')).retry,
    ).toBe(true);
  });
});
