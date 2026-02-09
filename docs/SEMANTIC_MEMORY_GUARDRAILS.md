# Semantic Memory — Implementation Guardrails (TZ v3)

**Product limitation (variant A):** Semantic search works only for records saved after this update. Backfill of existing .md files is out of scope (separate task).

---

1. **SQLite on Windows:** Use `better-sqlite3` (already in repo). No new native deps.
2. **Embedding BLOB:** Store as Float32Array little-endian. Store `embedding_dim` in table; on deserialize assert `length === embedding_dim`.
3. **memory_search:** Limit candidate set (e.g. last N chunks by `created_at`) to avoid search degradation.
4. **Fail-soft logging:** `console.warn` without secrets/fact/chunk text; only error type, status, len, userId/source.
5. **Tool descriptions:** Include final TZ v3 descriptions for `memory_search` and `memory_get` in Step 8.
6. **Search filter:** Use only rows where `embedding_dim == query_dim`.
