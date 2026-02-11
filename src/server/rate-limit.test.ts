import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert';
import { RateLimiter } from './rate-limit.js';

describe('RateLimiter', () => {
  before(() => {
    // Enable time mocking for Date and timers
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
  });

  after(() => {
    mock.timers.reset();
  });

  test('should allow requests within limit', () => {
    const limiter = new RateLimiter(2, 1000);
    assert.strictEqual(limiter.check('user1'), true);
    assert.strictEqual(limiter.check('user1'), true);
  });

  test('should block requests over limit', () => {
    const limiter = new RateLimiter(2, 1000);
    // Use up the limit
    limiter.check('user2');
    limiter.check('user2');

    // This one should be blocked
    assert.strictEqual(limiter.check('user2'), false);

    // Subsequent requests should also be blocked
    assert.strictEqual(limiter.check('user2'), false);
  });

  test('should reset limit after window expires', () => {
    const limiter = new RateLimiter(1, 1000);
    limiter.check('user3');
    assert.strictEqual(limiter.check('user3'), false);

    // Advance time by 1001ms (just over the window)
    mock.timers.tick(1001);

    // Should be allowed now
    assert.strictEqual(limiter.check('user3'), true);
  });

  test('should handle multiple users independently', () => {
    const limiter = new RateLimiter(1, 1000);

    // Block userA
    assert.strictEqual(limiter.check('userA'), true);
    assert.strictEqual(limiter.check('userA'), false);

    // userB should still be allowed
    assert.strictEqual(limiter.check('userB'), true);

    // And userB should get blocked independently
    assert.strictEqual(limiter.check('userB'), false);
  });

  test('cleanup should remove expired entries', () => {
    const limiter = new RateLimiter(1, 1000);
    limiter.check('userC');

    // Verify entry exists (indirectly via check returning false for limit=1)
    assert.strictEqual(limiter.check('userC'), false);

    // Advance time past window
    mock.timers.tick(1001);

    // Run cleanup
    limiter.cleanup();

    // Verify internal state (using any to access private property for test verification)
    const mapSize = (limiter as any).windows.size;

    // The map should be empty because userC's only request expired
    assert.strictEqual(mapSize, 0);

    // And subsequent check should work (and re-add entry)
    assert.strictEqual(limiter.check('userC'), true);
    assert.strictEqual((limiter as any).windows.size, 1);
  });
});
