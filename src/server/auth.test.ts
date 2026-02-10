import { test, describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { authMiddleware } from './auth.js';
import { config } from '../config/config.js';

// Mock Express objects
const mockReq = (headers = {}, query = {}) => ({
  headers,
  query,
} as any);

const mockRes = () => {
  const res: any = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.body = data;
    return res;
  };
  return res;
};

describe('Auth Middleware', () => {
  let originalToken;

  before(() => {
    originalToken = config.security.adminToken;
  });

  after(() => {
    config.security.adminToken = originalToken;
  });

  it('should allow access if ADMIN_TOKEN is not set', (t, done) => {
    config.security.adminToken = '';
    const req = mockReq();
    const res = mockRes();

    authMiddleware(req, res, () => {
      done();
    });
  });

  it('should allow access with correct token in header', (t, done) => {
    config.security.adminToken = 'secret123';
    const req = mockReq({ 'x-admin-token': 'secret123' });
    const res = mockRes();

    authMiddleware(req, res, () => {
      done();
    });
  });

  it('should allow access with correct token in query', (t, done) => {
    config.security.adminToken = 'secret123';
    const req = mockReq({}, { token: 'secret123' });
    const res = mockRes();

    authMiddleware(req, res, () => {
      done();
    });
  });

  it('should deny access with incorrect token', () => {
    config.security.adminToken = 'secret123';
    const req = mockReq({ 'x-admin-token': 'wrong' });
    const res = mockRes();
    let nextCalled = false;

    authMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
    assert.deepStrictEqual(res.body, { error: 'Unauthorized. Требуется ADMIN_TOKEN.' });
  });

  it('should deny access with empty token provided', () => {
    config.security.adminToken = 'secret123';
    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;

    authMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
  });

  it('should handle different token lengths safely', () => {
      config.security.adminToken = 'short';
      const req = mockReq({ 'x-admin-token': 'verylongtokenstring' });
      const res = mockRes();
      let nextCalled = false;

      authMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 401);
  });
});
