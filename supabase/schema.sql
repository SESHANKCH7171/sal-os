-- ==============================================================================
-- Seshank AI Labs OS — Unified Supabase SQL Schema (Milestone 1)
-- Precedence Order:
-- 1. FINAL_PIPELINE_PATCH.md
-- 2. GUARDRAILS_AND_HARDENING.md
-- 3. PERPETUAL_MEMORY_AND_ROUTING_SPEC.md
-- 4. HEAD_AGENT_GREEN_LIGHT_SPEC.md
-- 5. SESHANK_AI_LABS_OS.md
-- ==============================================================================

-- 0. Enable pgvector extension for episodic agent brain & semantic search
create extension if not exists vector;

-- 1. Companies Table (Perpetual Memory & Anti-Duplicate Brain)
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  normalized_domain text unique, -- e.g. 'analyticsdepot.com'
  company_slug text unique not null, -- fallback: lower(regexp_replace(company_name, '[^a-zA-Z0-9]', '', 'g'))
  city text, -- e.g. 'Jeddah', 'Khobar', 'Riyadh', 'Dubai', 'London'
  region text check (region in ('KSA', 'UAE', 'UK', 'US', 'OTHER')) default 'OTHER',
  lock_status text default 'available' check (lock_status in ('available', 'in_progress', 'contacted_cooldown', 'client', 'do_not_contact')),
  last_contacted_at timestamptz,
  cooldown_until timestamptz, -- Default: 90 days after last outreach
  total_contacts_approached int default 0,
  notes text,
  created_at timestamptz default now()
);

-- 2. Brand Vault (3 Core Offers + Dynamic AI Employee Role Playbooks)
create table if not exists brand_vault (
  id uuid primary key default gen_random_uuid(),
  offer_key text unique not null check (offer_key in ('saas_lead_gen', 'custom_ai_employee', 'founder_website')),
  display_name text not null,
  target_icp text not null,
  core_hook text not null,
  proof_points text not null,
  pricing_notes text not null,
  role_playbooks jsonb default '{}'::jsonb,
  writing_rules text not null default 'Zero em dashes. Use periods or commas only. Under 65 words for Step 1 cold emails. No flattery like "I hope this finds you well". Sound like a peer founder.',
  updated_at timestamptz default now()
);

-- 3. Leads & Multi-Channel Outreach Pipeline
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  full_name text not null,
  first_name text not null,
  title text,
  company text,
  industry text,
  linkedin_url text,
  normalized_linkedin_url text,
  email text,
  city text,
  location_region text default 'OTHER' check (location_region in ('UAE', 'KSA', 'UK', 'US', 'OTHER')),
  timezone text default 'UTC',
  is_historical_import boolean default false,
  vault_stage text default 'vaulted' check (vault_stage in ('vaulted', 'queued_for_today', 'active', 'completed', 'archived')),

  -- System 1 (Jev) Decisions & Green Light Gate
  jev_icp_qualified boolean default false,
  target_offer text check (target_offer in ('saas_lead_gen', 'custom_ai_employee', 'founder_website')),
  ai_employee_role text default 'none' check (ai_employee_role in ('ai_sdr', 'ai_receptionist', 'ai_ops_copilot', 'ai_support_agent', 'custom_workflow_agent', 'none')),
  channel_route text check (channel_route in ('dual_channel', 'linkedin_only', 'email_only')),
  jev_confidence_score float,
  needs_human_review boolean default false,

  -- Mandatory Justification Brief & Verified Research (Head Agent Green Light Spec)
  agent_reasoning jsonb default '{}'::jsonb,
  enrichment_summary text,
  evidence_sources jsonb default '[]'::jsonb, -- [{title, url, snippet, extracted_fact, published_date, trust_score}]

  -- Generated Assets (System 2: Gemini 2.5 Flash)
  linkedin_note text, -- blank for initial connects; < 300 chars for post-connect
  linkedin_dm_delivery text,
  email_subject text,
  email_step1 text, -- Permission-first, < 65 words, zero links/prices
  email_step2_followup text, -- Day 3 gentle bump
  email_step3_followup text, -- Day 7 value-add / breakup
  email_delivery_reply text, -- Pure value delivery (zero premature pricing)
  email_pilot_pitch text, -- Post-review commercial pitch

  -- Execution & Tracking Guardrails
  -- Strict Rule: email_status NEVER uses 'sending'. Uses sending_locked_at and current_email_step.
  linkedin_status text default 'pending' check (linkedin_status in ('pending', 'sent', 'connected', 'accepted', 'awaiting_green_light', 'green_lit', 'replied', 'skipped')),
  email_status text default 'pending' check (email_status in ('pending', 'awaiting_green_light', 'green_lit', 'step1_sent', 'step2_sent', 'step3_sent', 'replied', 'bounced', 'paused', 'rejected')),
  current_email_step int default 0 check (current_email_step between 0 and 3),
  sending_locked_at timestamptz,
  email_verification_status text default 'unverified' check (email_verification_status in ('unverified', 'deliverable', 'catch_all', 'undeliverable')),
  processing_attempts int default 0,
  last_error text,
  message_id_header text,
  next_email_at timestamptz,
  last_contacted_at timestamptz,
  created_at timestamptz default now()
);

-- Deduplication Indexes (Enforces Clean Memory)
create unique index if not exists idx_leads_unique_email on leads (lower(email)) where email is not null;
create unique index if not exists idx_leads_unique_linkedin on leads (normalized_linkedin_url) where normalized_linkedin_url is not null;
create index if not exists idx_leads_company_id on leads (company_id);
create index if not exists idx_leads_vault_stage on leads (vault_stage);
create index if not exists idx_leads_email_status on leads (email_status);
create index if not exists idx_leads_linkedin_status on leads (linkedin_status);

-- 4. Immutable Perpetual Outreach Ledger (Permanent Agency History)
create table if not exists outreach_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  agent_name text not null, -- 'vault_gatekeeper' | 'head_outreach_agent' | 'followup_guardian' | 'manual_import'
  channel text not null check (channel in ('email', 'linkedin_blank_connect', 'linkedin_dm', 'system')),
  event_type text not null, -- 'historical_sent' | 'drafted' | 'green_lit' | 'step1_sent' | 'followup_sent' | 'connected' | 'replied' | 'bounced' | 'rejected'
  region text,
  city text,
  summary text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- 5. Episodic Agent Brain (Learns from Seshank's edits, replies, and rejections)
create table if not exists agent_memory_episodes (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  region text,
  offer_key text,
  lesson_type text check (lesson_type in ('winning_angle', 'rejection_rule', 'style_correction', 'market_insight')),
  lesson_text text not null,
  embedding vector(768), -- Generated via Gemini text-embedding-004
  created_at timestamptz default now()
);

-- 6. Dynamic Day-of-Week Schedule & Regional Quota Rules
create table if not exists daily_schedule_rules (
  day_of_week int primary key check (day_of_week between 0 and 6), -- 0=Sun, 1=Mon ... 6=Sat
  day_name text not null,
  active_regions text[] not null, -- e.g. Sunday: ARRAY['KSA']
  priority_cities text[] default '{}', -- e.g. Sunday: ARRAY['Jeddah', 'Khobar', 'Riyadh']
  email_goal int not null,
  linkedin_goal int not null,
  region_weights jsonb default '{}'::jsonb, -- e.g. {"KSA": 6, "UAE": 6, "UK": 7, "US": 6}
  is_prep_only boolean default false
);

-- 7. Multi-Platform Content & Visual Calendar (LinkedIn Personal + Company + X)
create table if not exists content_posts (
  id uuid primary key default gen_random_uuid(),
  idea_group_id uuid not null default gen_random_uuid(),
  account_type text not null check (account_type in ('personal_seshank', 'company_seshank_ai_labs', 'x_account')),
  pillar text not null check (pillar in ('saas_lead_gen', 'custom_ai_employees', 'agentic_ai_progress', 'founder_website')),
  input_source text default 'text' check (input_source in ('text', 'voice')),
  raw_idea text,
  evidence_sources jsonb default '[]'::jsonb,
  hook_options jsonb default '[]'::jsonb,
  post_body text,
  x_format text default 'none' check (x_format in ('single_post', 'thread', 'none')),
  x_thread_items jsonb default '[]'::jsonb,
  visual_style text default 'text_only' check (visual_style in ('architecture_diagram', 'comparison_card', 'metric_infographic', 'website_showcase', 'text_only')),
  image_prompt text,
  image_url text,
  aspect_ratio text default '4:5',
  jev_qa_score float,
  status text default 'idea' check (status in ('idea', 'draft', 'ready', 'posted')),
  scheduled_date date,
  post_url text,
  created_at timestamptz default now()
);

-- 8. API Quota & SMTP Tracker
create table if not exists api_usage_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in (
    'apollo', 'tavily', 'serper', 'serpapi',
    'mesh_jev', 'gemini_text', 'gemini_image',
    'groq_whisper', 'hostinger_smtp'
  )),
  usage_date date not null default current_date,
  requests_count int not null default 0,
  unique (provider, usage_date)
);

-- 9. System Flags & Circuit Breakers (Deliverability & Rolling-24h Monitoring)
create table if not exists system_flags (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- 10. Private Storage Bucket for Branded Visuals
insert into storage.buckets (id, name, public)
values ('content-assets', 'content-assets', false)
on conflict (id) do nothing;

-- 11. Row Level Security Policies (Single-User Lock strictly to seshank@seshankailabs.com)
alter table companies enable row level security;
alter table brand_vault enable row level security;
alter table leads enable row level security;
alter table outreach_ledger enable row level security;
alter table agent_memory_episodes enable row level security;
alter table daily_schedule_rules enable row level security;
alter table content_posts enable row level security;
alter table api_usage_logs enable row level security;
alter table system_flags enable row level security;

-- Drop existing policies if any to ensure clean re-runnability
drop policy if exists "Seshank only - companies" on companies;
drop policy if exists "Seshank only - brand_vault" on brand_vault;
drop policy if exists "Seshank only - leads" on leads;
drop policy if exists "Seshank only - outreach_ledger" on outreach_ledger;
drop policy if exists "Seshank only - agent_memory_episodes" on agent_memory_episodes;
drop policy if exists "Seshank only - daily_schedule_rules" on daily_schedule_rules;
drop policy if exists "Seshank only - content_posts" on content_posts;
drop policy if exists "Seshank only - api_usage_logs" on api_usage_logs;
drop policy if exists "Seshank only - system_flags" on system_flags;
drop policy if exists "Seshank only - content-assets" on storage.objects;

create policy "Seshank only - companies" on companies for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - brand_vault" on brand_vault for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - leads" on leads for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - outreach_ledger" on outreach_ledger for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - agent_memory_episodes" on agent_memory_episodes for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - daily_schedule_rules" on daily_schedule_rules for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - content_posts" on content_posts for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - api_usage_logs" on api_usage_logs for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - system_flags" on system_flags for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - content-assets" on storage.objects for all using (bucket_id = 'content-assets' and auth.email() = 'seshank@seshankailabs.com');

-- 12. Seed Data: Daily Schedule Rules (Perpetual Memory & Routing Spec)
insert into daily_schedule_rules (day_of_week, day_name, active_regions, priority_cities, email_goal, linkedin_goal, region_weights, is_prep_only) values
  (0, 'Sunday',    ARRAY['KSA'],                     ARRAY['Jeddah', 'Khobar', 'Riyadh'], 20, 20, '{"KSA": 20}'::jsonb, false),
  (1, 'Monday',    ARRAY['KSA', 'UAE', 'UK', 'US'],  ARRAY['Jeddah', 'Khobar', 'Dubai', 'London'], 25, 20, '{"KSA": 6, "UAE": 6, "UK": 7, "US": 6}'::jsonb, false),
  (2, 'Tuesday',   ARRAY['KSA', 'UAE', 'UK', 'US'],  ARRAY['Jeddah', 'Khobar', 'Dubai', 'London'], 25, 20, '{"KSA": 6, "UAE": 6, "UK": 7, "US": 6}'::jsonb, false),
  (3, 'Wednesday', ARRAY['KSA', 'UAE', 'UK', 'US'],  ARRAY['Jeddah', 'Khobar', 'Dubai', 'London'], 25, 20, '{"KSA": 6, "UAE": 6, "UK": 7, "US": 6}'::jsonb, false),
  (4, 'Thursday',  ARRAY['KSA', 'UAE', 'UK', 'US'],  ARRAY['Jeddah', 'Khobar', 'Dubai', 'London'], 25, 20, '{"KSA": 6, "UAE": 6, "UK": 7, "US": 6}'::jsonb, false),
  (5, 'Friday',    ARRAY['UK', 'US'],                ARRAY['London', 'New York', 'San Francisco'], 20, 15, '{"UK": 10, "US": 10}'::jsonb, false),
  (6, 'Saturday',  ARRAY['KSA', 'UAE', 'UK', 'US'],  ARRAY['Jeddah', 'Khobar', 'Riyadh'], 0, 0, '{}'::jsonb, true)
on conflict (day_of_week) do update set
  day_name = excluded.day_name,
  active_regions = excluded.active_regions,
  priority_cities = excluded.priority_cities,
  email_goal = excluded.email_goal,
  linkedin_goal = excluded.linkedin_goal,
  region_weights = excluded.region_weights,
  is_prep_only = excluded.is_prep_only;

-- 13. Seed Data: Brand Vault (3 Core Offers + Dynamic AI Employee Role Playbooks)
insert into brand_vault (offer_key, display_name, target_icp, core_hook, proof_points, pricing_notes, role_playbooks, writing_rules) values
(
  'saas_lead_gen',
  'B2B Lead Gen for B2B SaaS Companies',
  'Founders, CEOs, COOs, Heads of Growth/BD at Seed–Series A B2B SaaS companies (US, UK, UAE, KSA)',
  'Permission-first 10-lead free sniper sheet before any commercial pitch',
  'Approached 100–150 companies, 3–5 engaged replies, signed Vineet Pinto, CEO of Analytics Depot',
  'Commercials (Step 3 only, never Step 1 or Step 2): 14-day paid pilot ($850–$900 / AED 3,100 for 30 deeply audited accounts) or performance/retainer model ($200/meeting booked)',
  '{}'::jsonb,
  'Zero em dashes. Use periods or commas only. Under 65 words for Step 1 cold emails. No flattery like "I hope this finds you well". Sound like a peer founder.'
),
(
  'custom_ai_employee',
  'Custom AI Employees (Vertical-Agnostic, Dynamically Diagnosed)',
  'Founders, Operators, Practice Leaders in Dental Clinics, Medical Practices, Salons, Hospitality, Real Estate, Construction, Logistics, Legal, E-commerce, High-Volume Services, and B2B Agencies (UAE, KSA, UK, US)',
  'Deploy turnkey AI Employees directly to eliminate operational bottlenecks, handle client comms 24/7, and recover missed revenue',
  'Zero headcount overhead, 24/7 instant response, turnkey integration into existing WhatsApp/Email/CRM workflows with human-in-the-loop oversight',
  'Setup fee ($1,500–$3,500 / 5,500–12,000 AED/SAR) + monthly maintenance/intelligence retainer ($500–$1,500/mo)',
  '{
    "ai_sdr": {
      "title": "AI SDR / Outbound Specialist",
      "target_verticals": ["B2B SaaS", "Agencies", "Consulting"],
      "workflow": "Account research, buying-signal tracking, outbound drafting, and reply qualification."
    },
    "ai_receptionist": {
      "title": "AI Front Desk & Receptionist",
      "target_verticals": ["Dental Clinics", "Medical Practices", "Salons", "Hospitality"],
      "workflow": "24/7 missed-call recovery, patient/guest qualification, direct calendar booking via WhatsApp/SMS."
    },
    "ai_ops_copilot": {
      "title": "AI Operations & Logistics Copilot",
      "target_verticals": ["Real Estate", "Construction", "Logistics", "Legal"],
      "workflow": "Inquiry intake, quote/document parsing, CRM updates, vendor follow-ups, and discrepancy alerts."
    },
    "ai_support_agent": {
      "title": "AI Tier-1 Customer Support Specialist",
      "target_verticals": ["E-commerce", "High-Volume Services"],
      "workflow": "Tier-1 ticket resolution, booking/order status lookups, returns processing, clean escalation to human staff."
    },
    "custom_workflow_agent": {
      "title": "Custom Workflow Automator",
      "target_verticals": ["Any niche with operational bottlenecks"],
      "workflow": "Automates specific repetitive operational bottlenecks identified through site audits and hiring signals."
    }
  }'::jsonb,
  'Zero em dashes. Direct, pain-focused, pragmatic. Highlight operational efficiency and instant ROI.'
),
(
  'founder_website',
  'High-Profile Founder Websites (Traditional Non-Tech Industries)',
  'High-profile Founders, Managing Directors, Principals, and Partners in Real Estate, Construction, Healthcare, and traditional non-tech industries (UAE, KSA, UK, US)',
  'Bespoke 1-page personal executive websites (firstname-lastname.com positioning) that build instant authority for referrals, partners, and investors',
  'Executive personal branding converts institutional capital, top talent, and elite joint ventures far better than corporate landing pages',
  '$750–$850 USD (US/UK) | 3,500 SAR / AED (KSA/UAE)',
  '{}'::jsonb,
  'Zero em dashes. Prestigious, respectful, peer-to-peer tone. Emphasize executive presence and digital authority.'
)
on conflict (offer_key) do update set
  display_name = excluded.display_name,
  target_icp = excluded.target_icp,
  core_hook = excluded.core_hook,
  proof_points = excluded.proof_points,
  pricing_notes = excluded.pricing_notes,
  role_playbooks = excluded.role_playbooks,
  writing_rules = excluded.writing_rules,
  updated_at = now();
