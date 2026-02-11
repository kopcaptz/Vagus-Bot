import fs from 'fs';
import path from 'path';
import { readMemories } from './src/memory/index.js';

const TEST_USER = 'bench_user';
const MEMORY_ROOT = path.join(process.cwd(), 'data', 'memory');
const USERS_DIR = path.join(MEMORY_ROOT, 'users');
const USER_DIR = path.join(USERS_DIR, TEST_USER);
const PROFILE_FILE = path.join(USER_DIR, 'profile.md');
const WORKING_FILE = path.join(USER_DIR, 'working.md');
const ARCHIVE_FILE = path.join(USER_DIR, 'archive.md');

function setup() {
  if (!fs.existsSync(MEMORY_ROOT)) {
    fs.mkdirSync(MEMORY_ROOT, { recursive: true });
  }
  if (!fs.existsSync(USERS_DIR)) {
    fs.mkdirSync(USERS_DIR, { recursive: true });
  }
  if (!fs.existsSync(USER_DIR)) {
    fs.mkdirSync(USER_DIR, { recursive: true });
  }

  const profileFacts = Array.from({ length: 100 }, (_, i) => `- [id:pf_${i}] [t:profile] [imp:high] Profile fact ${i}`).join('\n');
  const workingFacts = Array.from({ length: 500 }, (_, i) => `- [id:wk_${i}] [t:working] [imp:normal] Working fact ${i}`).join('\n');
  const archiveFacts = Array.from({ length: 200 }, (_, i) => `- [id:ar_${i}] [t:archive] [imp:low] Archive fact ${i}`).join('\n');

  fs.writeFileSync(PROFILE_FILE, profileFacts);
  fs.writeFileSync(WORKING_FILE, workingFacts);
  fs.writeFileSync(ARCHIVE_FILE, archiveFacts);

  console.log('Setup complete.');
}

function cleanup() {
  if (fs.existsSync(USER_DIR)) {
    fs.rmSync(USER_DIR, { recursive: true, force: true });
  }
}

async function runBenchmark() {
  console.log('Starting benchmark...');
  try {
    setup();

    // Warmup
    await readMemories(TEST_USER);

    const iterations = 1000;
    console.log(`Running ${iterations} iterations of readMemories...`);

    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      await readMemories(TEST_USER);
    }

    const end = performance.now();
    const duration = end - start;

    console.log(`Total time: ${duration.toFixed(2)}ms`);
    console.log(`Average time per call: ${(duration / iterations).toFixed(4)}ms`);

  } catch (err) {
    console.error('Benchmark failed:', err);
  } finally {
    cleanup();
  }
}

runBenchmark();
