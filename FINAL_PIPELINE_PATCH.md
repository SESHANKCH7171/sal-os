# Final Pipeline Patch (Closes All 6 End-to-End Gaps)

## 1. SQL Patch (Run After Previous Schemas)

```sql
-- Fix #1: Clean Send Lock + Step Counter (Never overwrite email_status with 'sending')
alter table leads add column if not exists current_email_step int default 0 check (current_email_step between 0 and 3);
alter table leads add column if not exists sending_locked_at timestamptz;

-- Fix #5: Normalized Deduplication Indexes
alter table leads add column if not exists normalized_linkedin_url text;
create unique index if not exists idx_leads_unique_email on leads (lower(email)) where email is not null;
create unique index if not exists idx_leads_unique_linkedin on leads (normalized_linkedin_url) where normalized_linkedin_url is not null;