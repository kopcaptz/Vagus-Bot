import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { runCompact, AIProcessor } from './compact.js';
import { appendFact } from '../storage/md/write.js';
import { readArchiveFacts } from '../storage/md/read.js';
import { FactLine } from '../types.js';
import { randomUUID } from 'crypto';

describe('Memory Compact Job', () => {
  const userId = 'test_compact_user_' + Date.now();
  const userDir = path.join(process.cwd(), 'data', 'memory', 'users', userId);

  // Helper to clear test data
  const cleanup = () => {
    if (fs.existsSync(userDir)) {
      fs.rmSync(userDir, { recursive: true, force: true });
    }
  };

  before(() => {
    cleanup();
    fs.mkdirSync(userDir, { recursive: true });

    // Create 60 dummy facts
    for (let i = 0; i < 60; i++) {
      const fact: FactLine = {
        id: randomUUID(),
        type: 'archive',
        importance: 'normal',
        expiresAt: null,
        text: `Old fact number ${i}`
      };
      appendFact(userId, fact);
    }
  });

  after(() => {
    cleanup();
  });

  test('should compact archive facts when count > threshold', async () => {
    // Mock AI Processor
    const mockProcessor: AIProcessor = async (msg: string) => {
      // Return a fixed JSON response
      return {
        text: JSON.stringify(['Summary Fact A', 'Summary Fact B']),
        model: 'mock-model',
        provider: 'mock-provider'
      };
    };

    // Run compaction with the mock
    await runCompact(mockProcessor);

    // Verify results
    const facts = readArchiveFacts(userId);

    // Check if facts count reduced
    // Initially 60. If runCompact logic is correct, it should reduce.
    assert.ok(facts.length < 60, `Facts count should be reduced. Current: ${facts.length}`);

    // Check if summaries exist
    const summaries = facts.filter(f => f.text.startsWith('Summary Fact'));
    assert.strictEqual(summaries.length, 2, 'Should have 2 summary facts');

    // Check if oldest facts are gone (the ones created first)
    // Assuming runCompact takes the first N facts (chronological order)
    const oldFact0 = facts.find(f => f.text === 'Old fact number 0');
    assert.strictEqual(oldFact0, undefined, 'Oldest fact should be removed');
  });
});
