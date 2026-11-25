# Upgrade Spec: Perpetual Agency Memory, Anti-Duplicate Brain & Dynamic Day/Geo Router

## 1. Enable pgvector & Perpetual Memory Tables (Supabase SQL)

```sql
-- Enable semantic episodic memory (Hermes / OpenClaw style)
create extension if not exists vector;

-- 1. Company-Level Hard Lock (Prevents contacting or hallucinating the same company twice)
create table companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  normalized_domain text unique, -- e.g. 'analyticsdepot.com'
  company_slug text unique not null, -- fallback if domain missing: lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))
  city text, -- e.g. 'Jeddah', 'Khobar', 'Riyadh', 'Dubai', 'London'
  region text check (region in ('KSA', 'UAE', 'UK', 'US', 'OTHER')) default 'OTHER',
  lock_status text default 'available' check (lock_status in ('available', 'in_progress', 'contacted_cooldown', 'client', 'do_not_contact')),
  last_contacted_at timestamptz,
  cooldown_until timestamptz, -- Default: 90 days after last outreach
  total_contacts_approached int default 0,
  notes text,
  created_at timestamptz default now()
);

-- Link leads table to companies + add city & vault status
alter table leads add column if not exists company_id uuid references companies(id);
alter table leads add column if not exists city text;
alter table leads add column if not exists is_historical_import boolean default false;
alter table leads add column if not exists vault_stage text default 'vaulted' check (vault_stage in ('vaulted', 'queued_for_today', 'active', 'completed', 'archived'));

-- 2. Immutable Perpetual Outreach Ledger (Permanent Agency History)
create table outreach_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  lead_id uuid references leads(id),
  agent_name text not null, -- 'vault_gatekeeper' | 'head_outreach_agent' | 'followup_guardian' | 'manual_import'
  channel text not null check (channel in ('email', 'linkedin_blank_connect', 'linkedin_dm', 'system')),
  event_type text not null, -- 'historical_sent' | 'drafted' | 'green_lit' | 'step1_sent' | 'followup_sent' | 'connected' | 'replied' | 'bounced' | 'rejected'
  region text,
  city text,
  summary text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- 3. Episodic Agent Brain (Learns from Seshank's edits, replies, and rejections)
create table agent_memory_episodes (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  region text,
  offer_key text,
  lesson_type text check (lesson_type in ('winning_angle', 'rejection_rule', 'style_correction', 'market_insight')),
  lesson_text text not null,
  embedding vector(768), -- Generated via Gemini text-embedding-004
  created_at timestamptz default now()
);

-- 4. Dynamic Day-of-Week Schedule & Regional Quota Rules
create table daily_schedule_rules (
  day_of_week int primary key check (day_of_week between 0 and 6), -- 0=Sun, 1=Mon ... 6=Sat
  day_name text not null,
  active_regions text[] not null, -- e.g. Sunday: ARRAY['KSA']
  priority_cities text[] default '{}', -- e.g. Sunday: ARRAY['Jeddah', 'Khobar', 'Riyadh']
  email_goal int not null,
  linkedin_goal int not null,
  region_weights jsonb default '{}'::jsonb, -- e.g. {"KSA": 6, "UAE": 6, "UK": 7, "US": 6}
  is_prep_only boolean default false
);

-- Seed Default Weekly Schedule
insert into daily_schedule_rules (day_of_week, day_name, active_regions, priority_cities, email_goal, linkedin_goal, region_weights, is_prep_only) values
  (0, 'Sunday',    ARRAY['KSA'],                     ARRAY['Jeddah', 'Khobar', 'Riyadh'], 20, 20, '{"KSA": 20}', false),
  (1, 'Monday',    ARRAY['KSA', 'UAE', 'UK', 'US'],  ARRAY['Jeddah', 'Khobar', 'Dubai', 'London'], 25, 20, '{"KSA": 6, "UAE": 6, "UK": 7, "US": 6}', false),
  (2, 'Tuesday',   ARRAY['KSA', 'UAE', 'UK', 'US'],  ARRAY['Jeddah', 'Khobar', 'Dubai', 'London'], 25, 20, '{"KSA": 6, "UAE": 6, "UK": 7, "US": 6}', false),
  (3, 'Wednesday', ARRAY['KSA', 'UAE', 'UK', 'US'],  ARRAY['Jeddah', 'Khobar', 'Dubai', 'London'], 25, 20, '{"KSA": 6, "UAE": 6, "UK": 7, "US": 6}', false),
  (4, 'Thursday',  ARRAY['KSA', 'UAE', 'UK', 'US'],  ARRAY['Jeddah', 'Khobar', 'Dubai', 'London'], 25, 20, '{"KSA": 6, "UAE": 6, "UK": 7, "US": 6}', false),
  (5, 'Friday',    ARRAY['UK', 'US'],                ARRAY['London', 'New York', 'San Francisco'], 20, 15, '{"UK": 10, "US": 10}', false),
  (6, 'Saturday',  ARRAY['KSA', 'UAE', 'UK', 'US'],  ARRAY['Jeddah', 'Khobar', 'Riyadh'], 0, 0, '{}', true)
on conflict (day_of_week) do nothing;

-- Enable RLS (Single-User Lock)
alter table companies enable row level security;
alter table outreach_ledger enable row level security;
alter table agent_memory_episodes enable row level security;
alter table daily_schedule_rules enable row level security;

create policy "Seshank only - companies" on companies for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - outreach_ledger" on outreach_ledger for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - agent_memory_episodes" on agent_memory_episodes for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - daily_schedule_rules" on daily_schedule_rules for all using (auth.email() = 'seshank@seshankailabs.com');