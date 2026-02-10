import { test, describe, it, mock, before, after } from 'node:test';
import assert from 'node:assert';
import { fetchWithRetry } from './retry.js';

describe('fetchWithRetry', () => {
  let originalFetch: any;

  before(() => {
    // Store original fetch
    if (global.fetch) {
      originalFetch = global.fetch;
    }
    // Enable fake timers
    mock.timers.enable({ apis: ['setTimeout'] });
  });

  after(() => {
    // Restore fetch
    if (originalFetch) {
      global.fetch = originalFetch;
    }
    mock.timers.reset();
  });

  it('should return response immediately on success (200)', async () => {
    const mockFetch = mock.fn(async () => new Response('ok', { status: 200 }));
    global.fetch = mockFetch;

    const res = await fetchWithRetry('http://example.com', {});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(mockFetch.mock.calls.length, 1);
  });

  it('should retry on network error and succeed', async () => {
    let callCount = 0;
    const mockFetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error('Network error');
      return new Response('ok', { status: 200 });
    });
    global.fetch = mockFetch;

    const baseDelayMs = 100;
    const promise = fetchWithRetry('http://example.com', {}, { baseDelayMs });

    // Fast-forward time for the retry delay
    mock.timers.tick(100);

    const res = await promise;
    assert.strictEqual(res.status, 200);
    assert.strictEqual(mockFetch.mock.calls.length, 2);
  });

  it('should retry on 503 Service Unavailable and succeed', async () => {
    let callCount = 0;
    const mockFetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) return new Response('error', { status: 503 });
      return new Response('ok', { status: 200 });
    });
    global.fetch = mockFetch;

    const baseDelayMs = 100;
    const promise = fetchWithRetry('http://example.com', {}, { baseDelayMs });

    mock.timers.tick(100);

    const res = await promise;
    assert.strictEqual(res.status, 200);
    assert.strictEqual(mockFetch.mock.calls.length, 2);
  });

  it('should exhaust retries on persistent network error', async () => {
    const mockFetch = mock.fn(async () => {
      throw new Error('Persistent network error');
    });
    global.fetch = mockFetch;

    const maxRetries = 2;
    const baseDelayMs = 100;
    const promise = fetchWithRetry('http://example.com', {}, { maxRetries, baseDelayMs });

    // 1st retry
    mock.timers.tick(baseDelayMs);
    // 2nd retry
    mock.timers.tick(baseDelayMs * 2);

    await assert.rejects(promise, /Persistent network error/);
    assert.strictEqual(mockFetch.mock.calls.length, maxRetries + 1); // Initial + 2 retries
  });

  it('should return last response on persistent 503 error', async () => {
    const mockFetch = mock.fn(async () => new Response('error', { status: 503 }));
    global.fetch = mockFetch;

    const maxRetries = 2;
    const baseDelayMs = 100;
    const promise = fetchWithRetry('http://example.com', {}, { maxRetries, baseDelayMs });

    // 1st retry
    mock.timers.tick(baseDelayMs);
    // 2nd retry
    mock.timers.tick(baseDelayMs * 2);

    const res = await promise;
    assert.strictEqual(res.status, 503);
    assert.strictEqual(mockFetch.mock.calls.length, maxRetries + 1);
  });

  it('should not retry on non-retryable error (e.g. 404)', async () => {
    const mockFetch = mock.fn(async () => new Response('Not Found', { status: 404 }));
    global.fetch = mockFetch;

    const res = await fetchWithRetry('http://example.com', {});
    assert.strictEqual(res.status, 404);
    assert.strictEqual(mockFetch.mock.calls.length, 1);
  });

  it('should respect Retry-After header on 429', async () => {
    let callCount = 0;
    const mockFetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': '2' } // 2 seconds
        });
      }
      return new Response('ok', { status: 200 });
    });
    global.fetch = mockFetch;

    const baseDelayMs = 100;
    const promise = fetchWithRetry('http://example.com', {}, { baseDelayMs });

    // The code calculates delayMs based on retry-after if present.
    // Retry-After: 2 => 2000ms.

    // Advance time by 100ms (base delay).
    mock.timers.tick(100);

    // Advance time to 2000ms total.
    mock.timers.tick(1900);

    const res = await promise;
    assert.strictEqual(res.status, 200);
    assert.strictEqual(mockFetch.mock.calls.length, 2);
  });
});
