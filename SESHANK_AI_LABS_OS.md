# Seshank AI Labs — Private Growth, Content & AI Employee OS (Master Spec)

## 1. Mission & Core Analogy
Build a private, single-user web application exclusively for **Seshank Chinnapotula** (`seshank@seshankailabs.com`), founder of **Seshank AI Labs**.

This app is an **Internal Dispatch Center** powered by a low-cost, high-precision multi-agent stack:
1. **System 1 Decision Firewall (Jev via Mesh API):** Handles all fast, fractional-cost routing, ICP qualification, dynamic AI Employee role diagnosis, entity/source trust verification, and pre-send QA.
2. **Verified Intelligence Waterfall (4 Free-Tier APIs + Domain Filter):** Uses Apollo for missing emails and Tavily -> Serper -> SerpAPI for live web research so every outreach hook and post stat is backed by a clickable Tier-1 URL.
3. **System 2 Writer & Designer (Gemini Paid API + Nano Banana 2.1):** Generates personalized outreach (20 LinkedIn/day + 25 Hostinger emails/day) and 3x/week multi-platform content (**LinkedIn Personal**, **LinkedIn Company**, and **X**) with clean branded visuals.
4. **Hands-Free Voice Capture (Groq Whisper Free Tier):** Lets Seshank speak raw content ideas, image edits, or single leads directly into the dashboard.
5. **Safe Execution Plane:** 1-click human-in-the-loop LinkedIn queue (zero ban risk) + throttled Hostinger SMTP sending + Hostinger IMAP auto-reply/bounce detection.

---

## 2. The 3 Core Products & Go-To-Market Positioning (Seed into `brand_vault`)

### Offer 1 (Primary Flagship): B2B Lead Gen for B2B SaaS Companies
- **Strategy:** Keep AI Employees internal; sell the verified finished output (sniper accounts, live buying triggers, deliverable emails, and outreach sequences).
- **Target ICP:** Founders, CEOs, COOs, Heads of Growth/BD at Seed–Series A B2B SaaS companies (US, UK, UAE, KSA).
- **Hook:** Permission-first 10-lead free sniper sheet before any commercial pitch.
- **Proof Point:** Approached 100–150 companies, 3–5 engaged replies, signed **Vineet Pinto, CEO of Analytics Depot**.
- **Commercials (Step 3 only, never Step 1 or Step 2):** 14-day paid pilot ($850–$900 / AED 3,100 for 30 deeply audited accounts) or performance/retainer model.

### Offer 2: Custom AI Employees (Vertical-Agnostic, Dynamically Diagnosed)
- **Strategy:** Deploy turnkey AI Employees directly for non-tech businesses today (and upsell to proven SaaS clients later).
- **Dynamic Role Playbooks (stored in `brand_vault.role_playbooks` JSON — editable in UI):**
  1. `ai_sdr` (B2B SaaS, Agencies, Consulting): Account research, buying-signal tracking, outbound drafting.
  2. `ai_receptionist` (Dental Clinics, Medical Practices, Salons, Hospitality): 24/7 missed-call recovery, patient/guest qualification, direct calendar booking.
  3. `ai_ops_copilot` (Real Estate, Construction, Logistics, Legal): Inquiry intake, quote/document parsing, CRM updates, vendor follow-ups.
  4. `ai_support_agent` (E-commerce, High-Volume Service): Tier-1 ticket resolution, booking/order lookups, clean escalation.
  5. `custom_workflow_agent` (Any niche): Automates a specific repetitive operational bottleneck spotted in their site/hiring signals.

### Offer 3: High-Profile Founder Websites (Traditional Non-Tech Industries)
- **Target ICP:** High-profile Founders, Managing Directors, Principals, and Partners in **Real Estate, Construction, Healthcare, and traditional non-tech industries** (UAE, KSA, UK, US).
- **Hook:** Bespoke 1-page personal executive websites (`firstname-lastname.com` positioning) that build instant authority for referrals, partners, and investors.
- **Commercials:** $750–$850 USD (US/UK) | 3,500 SAR / AED (KSA/UAE).

---

## 3. Single-User Security Lock (Mandatory)
1. Disable public signups in Supabase Auth.
2. Create one user manually in Supabase: `seshank@seshankailabs.com`.
3. `src/middleware.ts` blocks all unauthenticated requests and rejects any session where `user.email !== process.env.ALLOWED_USER_EMAIL`.
4. Every API route verifies session email (or `Authorization: Bearer ${process.env.CRON_SECRET}` for `/api/cron/*`).
5. All Supabase tables and the `content-assets` storage bucket enforce RLS: `auth.email() = 'seshank@seshankailabs.com'`.

---

## 4. Unified Supabase SQL Schema (`supabase/schema.sql`)

```sql
-- 1. Brand Vault (3 Core Offers + Dynamic AI Employee Role Playbooks)
create table brand_vault (
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

-- 2. Leads & Multi-Channel Outreach Pipeline
create table leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  first_name text not null,
  title text,
  company text,
  industry text,
  linkedin_url text,
  email text,
  location_region text default 'OTHER' check (location_region in ('UAE', 'KSA', 'UK', 'US', 'OTHER')),
  timezone text default 'UTC',

  -- System 1 (Jev) Decisions
  jev_icp_qualified boolean default false,
  target_offer text check (target_offer in ('saas_lead_gen', 'custom_ai_employee', 'founder_website')),
  ai_employee_role text default 'none' check (ai_employee_role in ('ai_sdr', 'ai_receptionist', 'ai_ops_copilot', 'ai_support_agent', 'custom_workflow_agent', 'none')),
  channel_route text check (channel_route in ('dual_channel', 'linkedin_only', 'email_only')),
  jev_confidence_score float,
  needs_human_review boolean default false,

  -- Verified Research & Citations
  enrichment_summary text,
  evidence_sources jsonb default '[]'::jsonb, -- [{title, url, snippet, published_date, trust_score}]

  -- Generated Assets (System 2: Gemini 2.5 Flash)
  linkedin_note text, -- strictly < 300 chars
  linkedin_dm_delivery text,
  email_subject text,
  email_step1 text, -- Permission-first, < 65 words, zero links/prices
  email_step2_followup text, -- Day 3 gentle bump
  email_step3_followup text, -- Day 7 value-add / breakup
  email_delivery_reply text, -- Pure value delivery (zero premature pricing)
  email_pilot_pitch text, -- Post-review commercial pitch

  -- Execution & Tracking
  linkedin_status text default 'pending' check (linkedin_status in ('pending', 'sent', 'accepted', 'replied', 'skipped')),
  email_status text default 'pending' check (email_status in ('pending', 'approved', 'step1_sent', 'step2_sent', 'step3_sent', 'replied', 'bounced', 'paused')),
  message_id_header text,
  next_email_at timestamptz,
  last_contacted_at timestamptz,
  created_at timestamptz default now()
);

-- 3. Multi-Platform Content & Visual Calendar (LinkedIn Personal + Company + X)
create table content_posts (
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

-- 4. API Quota & SMTP Tracker
create table api_usage_logs (
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

-- 5. Private Storage Bucket for Branded Visuals
insert into storage.buckets (id, name, public)
values ('content-assets', 'content-assets', false)
on conflict (id) do nothing;

-- 6. Enable Row Level Security (Single-User Hard Lock)
alter table brand_vault enable row level security;
alter table leads enable row level security;
alter table content_posts enable row level security;
alter table api_usage_logs enable row level security;

create policy "Seshank only - brand_vault" on brand_vault for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - leads" on leads for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - content_posts" on content_posts for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - api_usage_logs" on api_usage_logs for all using (auth.email() = 'seshank@seshankailabs.com');
create policy "Seshank only - content-assets" on storage.objects for all using (bucket_id = 'content-assets' and auth.email() = 'seshank@seshankailabs.com');