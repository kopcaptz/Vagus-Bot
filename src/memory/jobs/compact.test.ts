import { test, describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { runCompact, _deps } from './compact.js';
import type { FactLine, UserMeta } from '../types.js';
import type { AIResponse } from '../../ai/models.js';

// Mocks
const mockProcessWithAI = mock.fn(async (): Promise<AIResponse> => ({
    text: 'Summarized fact',
    model: 'mock-model',
    provider: 'mock-provider'
}));
const mockIngestFact = mock.fn(async () => {});
const mockDeleteChunks = mock.fn(() => 1);
const mockRefreshMeta = mock.fn((): UserMeta => ({
    version: 1,
    profileCount: 0,
    workingCount: 0,
    archiveCount: 1
}));
const mockInitDb = mock.fn(() => {});

const MOCK_USER_ID = 'test_user';
const MOCK_ARCHIVE_PATH = path.join(process.cwd(), 'data', 'memory', 'users', MOCK_USER_ID, 'archive.md');
const MOCK_ARCHIVE_CONTENT = [
  '- [id:ar_1] [t:archive] [imp:low] Fact 1',
  '- [id:ar_2] [t:archive] [imp:low] Fact 2',
  '- [id:ar_3] [t:archive] [imp:low] Fact 3',
  '- [id:ar_4] [t:archive] [imp:low] Fact 4',
  '- [id:ar_5] [t:archive] [imp:low] Fact 5',
  '- [id:ar_6] [t:archive] [imp:low] Fact 6',
  '- [id:ar_7] [t:archive] [imp:low] Fact 7',
  '- [id:ar_8] [t:archive] [imp:low] Fact 8',
  '- [id:ar_9] [t:archive] [imp:low] Fact 9',
  '- [id:ar_10] [t:archive] [imp:low] Fact 10',
  '- [id:ar_11] [t:archive] [imp:low] Fact 11',
].join('\n');

const FACTS_ARRAY: FactLine[] = [];
const lines = MOCK_ARCHIVE_CONTENT.split('\n');
for (const line of lines) {
    const id = line.match(/id:([^\]]+)/)?.[1];
    const text = line.split('] ').pop();
    if (id && text) {
        FACTS_ARRAY.push({ id, type: 'archive', importance: 'low', expiresAt: null, text });
    }
}

let writtenFileContent = '';

describe('Memory Compaction Job', () => {
  let originalDeps: any;

  before(() => {
    originalDeps = { ..._deps };

    // Inject mocks
    _deps.processWithAI = mockProcessWithAI as any;
    _deps.ingestFact = mockIngestFact;
    _deps.deleteChunksByFactId = mockDeleteChunks;
    _deps.refreshUserMetaCounts = mockRefreshMeta;
    _deps.initMemoryDb = mockInitDb;
    _deps.readArchiveFacts = (userId: string) => FACTS_ARRAY;
    _deps.getArchivePath = (userId: string) => MOCK_ARCHIVE_PATH;
    _deps.randomUUID = () => '00000000-0000-0000-0000-000000000000' as any;

    // Mock fs via _deps.fs
    _deps.fs = {
      ..._deps.fs,
      existsSync: (p: string) => {
        if (p.includes('users') && !p.endsWith('.md')) return true;
        if (p === MOCK_ARCHIVE_PATH) return true;
        return false;
      },
      readdirSync: ((p: string) => {
        if (p.includes('users')) {
           return [{ name: MOCK_USER_ID, isDirectory: () => true }];
        }
        return [];
      }),
      readFileSync: ((p: string) => {
        if (p === MOCK_ARCHIVE_PATH) return MOCK_ARCHIVE_CONTENT;
        return '';
      }),
      writeFileSync: ((p: string, data: string) => {
        if (p === MOCK_ARCHIVE_PATH) {
          writtenFileContent = data;
        }
      }),
    } as any;
  });

  after(() => {
    // Restore original deps
    Object.assign(_deps, originalDeps);
    mock.restoreAll();
  });

  it('should compact old archive facts', async () => {
    await runCompact();

    // Verify processWithAI called
    assert.strictEqual(mockProcessWithAI.mock.callCount(), 1);

    // Verify file written
    assert.ok(writtenFileContent.includes('Summarized fact'));
    assert.ok(!writtenFileContent.includes('[id:ar_1]'));
    assert.ok(writtenFileContent.includes('[id:ar_6]'));

    // Verify chunks deleted
    assert.strictEqual(mockDeleteChunks.mock.callCount(), 5);

    // Verify ingestion
    assert.strictEqual(mockIngestFact.mock.callCount(), 1);
  });
});
