import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Путь к файлу БД. Создаем папку data в корне проекта, если её нет.
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'bot.db');
const db = new Database(dbPath, { verbose: console.log }); // verbose для логов в консоль

export function initDatabase() {
  console.log('🔄 Initializing database...');

  // 1. Таблица messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT,
      message_text TEXT NOT NULL,
      is_bot BOOLEAN DEFAULT 0,
      ai_model TEXT,
      ai_provider TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
  `);

  // 2. Таблица users
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      message_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);
  `);

  // 3. Таблица sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL UNIQUE,
      user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      message_count INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_message_at ON sessions(last_message_at);
  `);

  console.log('✅ Database initialized successfully.');
  console.log(`📂 Database location: ${dbPath}`);
}

export default db;
