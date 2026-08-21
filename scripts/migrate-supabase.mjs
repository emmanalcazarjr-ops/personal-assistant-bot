const token = process.env.SUPABASE_ACCESS_TOKEN || '';
const ref = process.env.SUPABASE_PROJECT_REF || 'hulyouteasfuetiqlacq';

const sql = `
-- 1. Portfolio Leads
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

-- 2. Page Views
create table if not exists public.page_views (
  id uuid primary key default gen_random_uuid(),
  page text not null default '/',
  created_at timestamptz not null default now()
);

-- 3. Chatbot Messages
create table if not exists public.chatbot_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

-- 4. Curation Queue (Supabase mirror for Antigravity)
create table if not exists public.curation_queue (
  id text primary key,
  short_id text not null,
  title text not null,
  category text not null,
  target_project text not null default 'general',
  priority text not null default 'medium',
  status text not null default 'pending',
  url text,
  summary text,
  why_it_matters text,
  antigravity_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. Calorie Logs (Supabase mirror for Antigravity)
create table if not exists public.calorie_logs (
  id uuid primary key default gen_random_uuid(),
  meal_name text not null,
  calories int not null default 0,
  protein int default 0,
  carbs int default 0,
  fat int default 0,
  source text not null default 'telegram',
  log_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.leads enable row level security;
alter table public.page_views enable row level security;
alter table public.chatbot_messages enable row level security;
alter table public.curation_queue enable row level security;
alter table public.calorie_logs enable row level security;

-- Public inserts for leads & page_views
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'Allow public insert leads') then
    create policy "Allow public insert leads" on public.leads for insert to anon with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Allow public insert page_views') then
    create policy "Allow public insert page_views" on public.page_views for insert to anon with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Allow public select page_views') then
    create policy "Allow public select page_views" on public.page_views for select to anon using (true);
  end if;
end $$;
`;

async function main() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const data = await res.json();
  console.log('Migration Result:', data);
}

main().catch(console.error);
