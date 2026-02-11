import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authMiddleware } from './auth.js';
import { config } from '../config/config.js';

type MockResponse = {
  statusCode: number | null;
  body: unknown;
  status: (code: number) => { json: (payload: unknown) => void };
};

function makeMockRes(): MockResponse {
  const response: MockResponse = {
    statusCode: null,
    body: null,
    status(code: number) {
      response.statusCode = code;
      return {
        json(payload: unknown) {
          response.body = payload;
        },
      };
    },
  };
  return response;
}

describe('authMiddleware', () => {
  let originalToken: string;

  before(() => {
    originalToken = config.security.adminToken;
  });

  after(() => {
    config.security.adminToken = originalToken;
  });

  test('returns 401 when ADMIN_TOKEN is not configured', () => {
    config.security.adminToken = '';
    const req = { headers: {}, query: {} } as any;
    const res = makeMockRes() as any;
    let calledNext = false;

    authMiddleware(req, res, () => {
      calledNext = true;
    });

    assert.equal(calledNext, false);
    assert.equal(res.statusCode, 401);
    assert.match(String((res.body as any)?.error ?? ''), /ADMIN_TOKEN not configured/);
  });

  test('allows access for a valid X-Admin-Token', () => {
    config.security.adminToken = 'valid-token';
    const req = { headers: { 'x-admin-token': 'valid-token' }, query: {} } as any;
    const res = makeMockRes() as any;
    let calledNext = false;

    authMiddleware(req, res, () => {
      calledNext = true;
    });

    assert.equal(calledNext, true);
    assert.equal(res.statusCode, null);
  });

  test('allows access for a valid query token', () => {
    config.security.adminToken = 'query-token';
    const req = { headers: {}, query: { token: 'query-token' } } as any;
    const res = makeMockRes() as any;
    let calledNext = false;

    authMiddleware(req, res, () => {
      calledNext = true;
    });

    assert.equal(calledNext, true);
    assert.equal(res.statusCode, null);
  });

  test('returns 401 for invalid token', () => {
    config.security.adminToken = 'valid-token';
    const req = { headers: { 'x-admin-token': 'invalid-token' }, query: {} } as any;
    const res = makeMockRes() as any;
    let calledNext = false;

    authMiddleware(req, res, () => {
      calledNext = true;
    });

    assert.equal(calledNext, false);
    assert.equal(res.statusCode, 401);
    assert.match(String((res.body as any)?.error ?? ''), /Unauthorized/);
  });

  test('does not throw on different token lengths', () => {
    config.security.adminToken = 'short';
    const req = { headers: { 'x-admin-token': 'very-long-invalid-token-value' }, query: {} } as any;
    const res = makeMockRes() as any;
    let calledNext = false;

    assert.doesNotThrow(() => {
      authMiddleware(req, res, () => {
        calledNext = true;
      });
    });

    assert.equal(calledNext, false);
    assert.equal(res.statusCode, 401);
  });
});
