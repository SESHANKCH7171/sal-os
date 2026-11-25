# Upgrade Spec: Head Outreach Agent & Mandatory "Green Light" Approval Gate

## 1. Core Operating Rule (Strict Human-in-the-Loop)
The Head Outreach Agent for Seshank AI Labs NEVER sends an email or LinkedIn message autonomously.
- **Email:** Stops strictly at `email_status = 'awaiting_green_light'`. Sends via Hostinger SMTP ONLY after Seshank clicks **Give Green Light** (`email_status = 'green_lit'`).
- **LinkedIn:** Zero AI drafting on initial connection requests (always send **blank connection requests**, zero note). The Head Agent triggers ONLY when a lead moves to `linkedin_status = 'connected'`, drafts the post-connect outreach, surfaces a **Connected Signal** alert, and waits at `linkedin_status = 'awaiting_green_light'` until Seshank clicks **Give Green Light**.

---

## 2. Mandatory Justification Brief (Required Before Every Green Light)
For every drafted email and post-connect LinkedIn message, the Head Agent MUST output and store a structured `agent_reasoning` JSON object alongside verified `evidence_sources[]`:

```json
{
  "chosen_offer": "saas_lead_gen | custom_ai_employee | founder_website",
  "ai_employee_role": "ai_sdr | ai_receptionist | ai_ops_copilot | ai_support_agent | none",
  "why_this_product": "1-2 concise sentences explaining why this exact Seshank AI Labs offer fits this prospect right now.",
  "what_they_lack": "Concrete gap discovered (e.g., 'No personal executive website for his name; company site lacks leadership authority page' or 'Hiring 3 SDRs with no outbound intent tooling').",
  "how_it_was_found": "Exact discovery steps taken (e.g., 'Searched founder name + company via Tavily, audited company domain, verified active hiring post on LinkedIn').",
  "confidence_score": 0.91,
  "reliable_sources": [
    {
      "title": "Exact page or article title",
      "url": "[https://verified-tier1-domain.com/](https://verified-tier1-domain.com/)...",
      "extracted_fact": "The exact verbatim signal backing the gap",
      "trust_score": 9
    }
  ]
}