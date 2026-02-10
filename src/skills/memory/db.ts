/**
 * SQLite layer for semantic memory — re-exports from Memory v2 storage.
 * Single DB: data/sqlite/memory.sqlite (with fact_id column).
 */

export {
  initMemoryDb,
  getMemoryDb,
  closeMemoryDb,
  getDbPath,
  type MemoryChunkRow,
} from '../../memory/storage/sqlite/db.js';
