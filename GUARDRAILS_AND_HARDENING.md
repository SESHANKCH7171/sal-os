# Seshank AI Labs OS — Production Guardrails & Spec Precedence Lock

## 0. Spec Precedence Rule (READ FIRST)
When multiple `.md` files exist in this repository, resolve any conflict using this strict priority order (highest to lowest):
1. `GUARDRAILS_AND_HARDENING.md` (this file — overrides all)
2. `PERPETUAL_MEMORY_AND_ROUTING_SPEC.md` (3-layer memory, companies lock, Sunday KSA / weekday global routing)
3. `HEAD_AGENT_GREEN_LIGHT_SPEC.md` (mandatory Green Light gate, blank LinkedIn connects, post-connect trigger, Justification Brief)
4. `SESHANK_AI_LABS_OS.md` (base stack, offers, LinkedIn+X content, Nano Banana 2.1, Groq Whisper)

Key Overrides Always Active:
- LinkedIn initial outreach is ALWAYS a **blank connection request** (zero note). AI drafts ONLY after `linkedin_status = 'connected'`.
- Emails NEVER auto-send after drafting. They MUST stop at `awaiting_green_light` until Seshank clicks **Give Green Light**.

---

## 1. External Cron Trigger (Bypasses Vercel Hobby 1/Day Cron Limit)
Do NOT rely on Vercel Hobby crons for 15-minute or 30-minute intervals.
- Keep `/api/cron/send-emails` and `/api/cron/sync-imap` protected by `Authorization: Bearer ${process.env.CRON_SECRET}`.
- Create `.github/workflows/agency-os-cron.yml` to trigger:
  - `/api/cron/send-emails` every 15 minutes (`*/15 * * * *`)
  - `/api/cron/sync-imap` every 30 minutes (`*/30 * * * *`)
  - (Alternatively, configure the same two URLs in free cron-job.org).

---

## 2. Email Deliverability & Hostinger Rolling-24h Circuit Breaker
Add columns to `leads` and a `system_flags` table in Supabase:

```sql
alter table leads add column if not exists email_verification_status text default 'unverified'
  check (email_verification_status in ('unverified', 'deliverable', 'catch_all', 'undeliverable'));
alter table leads add column if not exists processing_attempts int default 0;
alter table leads add column if not exists last_error text;

create table if not exists system_flags (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

alter table system_flags enable row level security;
create policy "Seshank only - system_flags" on system_flags for all using (auth.email() = 'seshank@seshankailabs.com');