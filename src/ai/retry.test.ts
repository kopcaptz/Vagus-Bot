import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from './retry.js';

describe('fetchWithRetry', () => {
  let originalFetch: typeof global.fetch;
  let originalSetTimeout: typeof global.setTimeout;
  let fetchMock: any;
  let setTimeoutMock: any;

  before(() => {
    originalFetch = global.fetch;
    originalSetTimeout = global.setTimeout;
  });

  after(() => {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  });

  it('should return response immediately on success (200)', async () => {
    fetchMock = mock.fn(async () => new Response('ok', { status: 200 }));
    global.fetch = fetchMock;

    const res = await fetchWithRetry('http://example.com', {});
    assert.equal(res.status, 200);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('should retry on 503 and succeed', async () => {
    let callCount = 0;
    fetchMock = mock.fn(async () => {
      callCount++;
      if (callCount === 1) return new Response('error', { status: 503 });
      return new Response('ok', { status: 200 });
    });
    global.fetch = fetchMock;

    // Mock setTimeout to be immediate but track calls
    const timeouts: number[] = [];
    global.setTimeout = ((cb: Function, ms: number) => {
      timeouts.push(ms);
      cb();
      return {} as any; // return timer object dummy
    }) as any;

    const res = await fetchWithRetry('http://example.com', {}, { maxRetries: 2, baseDelayMs: 100 });

    assert.equal(res.status, 200);
    assert.equal(fetchMock.mock.callCount(), 2);
    assert.equal(timeouts.length, 1);
    assert.equal(timeouts[0], 100); // 100 * 2^0 = 100
  });

  it('should exhaust retries and return last error response', async () => {
    fetchMock = mock.fn(async () => new Response('error', { status: 503 }));
    global.fetch = fetchMock;

    const timeouts: number[] = [];
    global.setTimeout = ((cb: Function, ms: number) => {
      timeouts.push(ms);
      cb();
      return {} as any;
    }) as any;

    const res = await fetchWithRetry('http://example.com', {}, { maxRetries: 2, baseDelayMs: 100 });

    assert.equal(res.status, 503);
    assert.equal(fetchMock.mock.callCount(), 3); // Initial + 2 retries
    assert.equal(timeouts.length, 2);
    // Delays: 100*2^0=100, 100*2^1=200
    assert.deepEqual(timeouts, [100, 200]);
  });

  it('should not retry on non-retryable error (404)', async () => {
    fetchMock = mock.fn(async () => new Response('not found', { status: 404 }));
    global.fetch = fetchMock;

    const res = await fetchWithRetry('http://example.com', {});
    assert.equal(res.status, 404);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('should respect Retry-After header on 429', async () => {
    let callCount = 0;
    fetchMock = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('rate limit', {
          status: 429,
          headers: { 'Retry-After': '5' }
        });
      }
      return new Response('ok', { status: 200 });
    });
    global.fetch = fetchMock;

    const timeouts: number[] = [];
    global.setTimeout = ((cb: Function, ms: number) => {
      timeouts.push(ms);
      cb();
      return {} as any;
    }) as any;

    await fetchWithRetry('http://example.com', {}, { maxRetries: 1 });

    assert.equal(timeouts.length, 1);
    assert.equal(timeouts[0], 5000); // 5 seconds
  });

  it('should retry on network error', async () => {
    let callCount = 0;
    fetchMock = mock.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error('Network Error');
      return new Response('ok', { status: 200 });
    });
    global.fetch = fetchMock;

    const timeouts: number[] = [];
    global.setTimeout = ((cb: Function, ms: number) => {
      timeouts.push(ms);
      cb();
      return {} as any;
    }) as any;

    const res = await fetchWithRetry('http://example.com', {}, { maxRetries: 1, baseDelayMs: 100 });

    assert.equal(res.status, 200);
    assert.equal(fetchMock.mock.callCount(), 2);
    assert.equal(timeouts.length, 1);
  });

  it('should throw error after exhausting retries on network error', async () => {
    fetchMock = mock.fn(async () => {
      throw new Error('Persistent Network Error');
    });
    global.fetch = fetchMock;

    const timeouts: number[] = [];
    global.setTimeout = ((cb: Function, ms: number) => {
      timeouts.push(ms);
      cb();
      return {} as any;
    }) as any;

    await assert.rejects(
      async () => await fetchWithRetry('http://example.com', {}, { maxRetries: 2, baseDelayMs: 100 }),
      /Persistent Network Error/
    );

    assert.equal(fetchMock.mock.callCount(), 3);
    assert.equal(timeouts.length, 2);
  });
});
