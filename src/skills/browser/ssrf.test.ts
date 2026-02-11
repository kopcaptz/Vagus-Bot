import { test } from 'node:test';
import assert from 'node:assert';
import { isPrivateIP } from './ssrf.js';

test('isPrivateIP blocks private IPv4 ranges', () => {
  assert.strictEqual(isPrivateIP('127.0.0.1'), true, 'Loopback');
  assert.strictEqual(isPrivateIP('10.0.0.1'), true, 'Private 10.x');
  assert.strictEqual(isPrivateIP('192.168.1.1'), true, 'Private 192.168.x');
  assert.strictEqual(isPrivateIP('172.16.0.1'), true, 'Private 172.16.x');
  assert.strictEqual(isPrivateIP('169.254.1.1'), true, 'Link-local');
  assert.strictEqual(isPrivateIP('0.0.0.0'), true, 'Unspecified');
});

test('isPrivateIP blocks private IPv6 ranges', () => {
  assert.strictEqual(isPrivateIP('::1'), true, 'Loopback');
  assert.strictEqual(isPrivateIP('fd00::1'), true, 'Unique Local');
  assert.strictEqual(isPrivateIP('fe80::1'), true, 'Link-local');
});

test('isPrivateIP blocks IPv4-mapped IPv6 addresses', () => {
  assert.strictEqual(isPrivateIP('::ffff:127.0.0.1'), true, 'Mapped Loopback');
  assert.strictEqual(isPrivateIP('::ffff:192.168.1.1'), true, 'Mapped Private');
});

test('isPrivateIP allows public IPs', () => {
  assert.strictEqual(isPrivateIP('8.8.8.8'), false, 'Google DNS');
  assert.strictEqual(isPrivateIP('1.1.1.1'), false, 'Cloudflare DNS');
  assert.strictEqual(isPrivateIP('142.250.1.1'), false, 'Public IPv4');
  assert.strictEqual(isPrivateIP('2606:4700:4700::1111'), false, 'Public IPv6');
});
