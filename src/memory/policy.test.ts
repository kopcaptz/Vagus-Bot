import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyFact } from './policy.js';
import { DEFAULT_POLICY } from './types.js';

describe('classifyFact', () => {
  it('should use meta type when provided (profile)', () => {
    const result = classifyFact('some text', { type: 'profile' });
    assert.strictEqual(result.type, 'profile');
    assert.strictEqual(result.importance, 'high');
    assert.strictEqual(result.expiresAt, null);
  });

  it('should use meta type when provided (working)', () => {
    const result = classifyFact('some text', { type: 'working' });
    assert.strictEqual(result.type, 'working');
    assert.strictEqual(result.importance, 'normal');

    // Check if expiresAt is roughly 14 days from now
    // We allow a small margin of error (e.g. if test runs exactly at midnight crossover)
    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + DEFAULT_POLICY.workingDefaultDays);
    const expectedStr = expectedDate.toISOString().slice(0, 10);

    assert.strictEqual(result.expiresAt, expectedStr);
  });

  it('should use meta type when provided (archive)', () => {
    // Note: current implementation defaults to 'normal' importance if type is archive but provided via meta
    const result = classifyFact('some text', { type: 'archive' });
    assert.strictEqual(result.type, 'archive');
    assert.strictEqual(result.importance, 'normal');
    assert.strictEqual(result.expiresAt, null);
  });

  it('should respect explicit importance in meta', () => {
    const result = classifyFact('some text', { type: 'working', importance: 'high' });
    assert.strictEqual(result.type, 'working');
    assert.strictEqual(result.importance, 'high');
  });

  it('should respect explicit expiresAt in meta', () => {
    const explicitDate = '2025-12-31';
    const result = classifyFact('some text', { type: 'working', expiresAt: explicitDate });
    assert.strictEqual(result.type, 'working');
    assert.strictEqual(result.expiresAt, explicitDate);
  });

  it('should classify as profile based on keywords', () => {
    const texts = [
      'Меня зовут Иван',
      'Мое имя Петр',
      'Я предпочитаю чай',
      'Моя профессия программист',
      'Я живу в Москве'
    ];

    for (const text of texts) {
      const result = classifyFact(text);
      assert.strictEqual(result.type, 'profile', `Failed for text: "${text}"`);
      assert.strictEqual(result.importance, 'high');
      assert.strictEqual(result.expiresAt, null);
    }
  });

  it('should classify as working based on keywords', () => {
    const texts = [
      'Сейчас делаем задачу',
      'Мы ставим эксперимент',
      'У нас есть план',
      'Мы работаем над проектом',
      'Текущая задача'
    ];

    for (const text of texts) {
      const result = classifyFact(text);
      assert.strictEqual(result.type, 'working', `Failed for text: "${text}"`);
      assert.strictEqual(result.importance, 'normal');

      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + DEFAULT_POLICY.workingDefaultDays);
      const expectedStr = expectedDate.toISOString().slice(0, 10);
      assert.strictEqual(result.expiresAt, expectedStr);
    }
  });

  it('should classify as archive by default', () => {
    const texts = [
      'Просто какой-то текст',
      'Привет мир',
      'Что-то интересное случилось'
    ];

    for (const text of texts) {
      const result = classifyFact(text);
      assert.strictEqual(result.type, 'archive', `Failed for text: "${text}"`);
      assert.strictEqual(result.importance, 'low');
      assert.strictEqual(result.expiresAt, null);
    }
  });

  it('should classify mixed case keywords correctly', () => {
    const result = classifyFact('МЕНЯ ЗОВУТ АЛЕКСЕЙ');
    assert.strictEqual(result.type, 'profile');
  });
});
