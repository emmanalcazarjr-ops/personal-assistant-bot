-- ============================================================
-- personal-assistant-bot schema (Supabase shared backend)
-- Run in the Supabase SQL editor, or apply with scripts/apply-schema.mjs
-- ============================================================

-- Chat memory for the AI
create table if not exists assistant_messages (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists assistant_messages_chat_created_idx
  on assistant_messages (chat_id, created_at);

-- Reminders / to-dos
create table if not exists reminders (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  text text not null,
  due_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists reminders_due_idx
  on reminders (due_at) where not done;

create index if not exists reminders_chat_idx
  on reminders (chat_id, due_at);

-- Quick notes
create table if not exists assistant_notes (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  content text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists assistant_notes_chat_created_idx
  on assistant_notes (chat_id, created_at desc);

-- Lock down: only the service role / DB owner can access
alter table assistant_messages enable row level security;
alter table reminders enable row level security;
alter table assistant_notes enable row level security;
