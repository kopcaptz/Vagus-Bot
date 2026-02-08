// TypeScript типы для БД

export interface Message {
  id: number;
  message_id: string | null;
  chat_id: string;
  user_id: string;
  username: string | null;
  message_text: string;
  is_bot: boolean;
  ai_model: string | null;
  ai_provider: string | null;
  created_at: string;
}

export interface User {
  user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  last_seen: string;
  message_count: number;
}

export interface Session {
  session_id: string;
  chat_id: string;
  user_id: string | null;
  created_at: string;
  last_message_at: string;
  message_count: number;
}
