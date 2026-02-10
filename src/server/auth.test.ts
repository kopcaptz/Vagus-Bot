import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert';
import { authMiddleware } from './auth.js';
import { config } from '../config/config.js';

describe('authMiddleware', () => {
  let originalToken: string;

  before(() => {
    // Save original token
    originalToken = config.security.adminToken;
  });

  after(() => {
    // Restore original token
    config.security.adminToken = originalToken;
  });

  test('should call next() when no admin token is configured', (t) => {
    config.security.adminToken = '';

    const req = { headers: {}, query: {} } as any;
    const res = {} as any;
    const next = mock.fn();

    authMiddleware(req, res, next);

    assert.strictEqual(next.mock.callCount(), 1);
  });

  test('should return 401 when token is configured but not provided', (t) => {
    config.security.adminToken = 'secret-token';

    const req = { headers: {}, query: {} } as any;
    const res = {
      status: mock.fn((code) => res),
      json: mock.fn(),
    } as any;
    const next = mock.fn();

    authMiddleware(req, res, next);

    assert.strictEqual(next.mock.callCount(), 0);
    assert.strictEqual(res.status.mock.callCount(), 1);
    assert.deepStrictEqual(res.status.mock.calls[0].arguments, [401]);
    assert.strictEqual(res.json.mock.callCount(), 1);
    assert.deepStrictEqual(res.json.mock.calls[0].arguments, [{ error: 'Unauthorized. Требуется ADMIN_TOKEN.' }]);
  });

  test('should return 401 when incorrect token provided', (t) => {
    config.security.adminToken = 'secret-token';

    const req = { headers: { 'x-admin-token': 'wrong-token' }, query: {} } as any;
    const res = {
      status: mock.fn((code) => res),
      json: mock.fn(),
    } as any;
    const next = mock.fn();

    authMiddleware(req, res, next);

    assert.strictEqual(next.mock.callCount(), 0);
    assert.strictEqual(res.status.mock.callCount(), 1);
    assert.deepStrictEqual(res.status.mock.calls[0].arguments, [401]);
  });

  test('should call next() when correct token provided in header', (t) => {
    config.security.adminToken = 'secret-token';

    const req = { headers: { 'x-admin-token': 'secret-token' }, query: {} } as any;
    const res = {} as any;
    const next = mock.fn();

    authMiddleware(req, res, next);

    assert.strictEqual(next.mock.callCount(), 1);
  });

  test('should call next() when correct token provided in query', (t) => {
    config.security.adminToken = 'secret-token';

    const req = { headers: {}, query: { token: 'secret-token' } } as any;
    const res = {} as any;
    const next = mock.fn();

    authMiddleware(req, res, next);

    assert.strictEqual(next.mock.callCount(), 1);
  });
});
