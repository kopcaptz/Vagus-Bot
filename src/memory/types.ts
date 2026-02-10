/**
 * Memory v2 — типы и интерфейсы.
 */

export type FactType = 'profile' | 'working' | 'archive';
export type Importance = 'high' | 'normal' | 'low';

export interface FactLine {
  id: string;
  type: FactType;
  importance: Importance;
  expiresAt: string | null; // YYYY-MM-DD, only for working
  text: string;
}

export interface UserMeta {
  version: number;
  lastCompactAt?: number;
  profileCount: number;
  workingCount: number;
  archiveCount: number;
}

export interface PolicyConfig {
  minLen: number;
  maxLen: number;
  semanticDedupThreshold: number;
  halfLifeDays: number;
  maxFactsPerUser: number;
  maxProfileFacts: number;
  maxWorkingFacts: number;
  workingDefaultDays: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  minLen: 12,
  maxLen: 240,
  semanticDedupThreshold: 0.9,
  halfLifeDays: 60,
  maxFactsPerUser: 500,
  maxProfileFacts: 50,
  maxWorkingFacts: 50,
  workingDefaultDays: 14,
};

export type MemoryBlockType = 'profile' | 'working' | 'archive';

export interface ValidationResult {
  ok: boolean;
  reason?: string; // length | question | command | secret | duplicate | semantic_duplicate
}

export interface SearchResultWithFactId {
  id: string;       // chunk id
  fact_id: string;
  score: number;
  preview: string;
  created_at: number;
  source: string;
  type?: FactType;
  importance?: Importance;
}
