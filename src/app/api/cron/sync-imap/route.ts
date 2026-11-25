import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncHostingerImap } from "@/lib/email/hostinger-imap";
import { generateZeroPitchPostConnectDm } from "@/lib/ai/linkedin-dm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleImapSync(req);
}

export async function GET(req: NextRequest) {
  return handleImapSync(req);
}

async function handleImapSync(req: NextRequest) {
  try {
    // 1. Strict Cron Secret Authentication
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized cron execution." }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const now = new Date();

    // 2. Fetch and parse incoming messages & bounces from Hostinger IMAP
    const { repliesDetected, bouncesDetected, linkedinAlerts } = await syncHostingerImap(48);

    let repliesMatched = 0;
    let bouncesMatched = 0;
    let linkedinAcceptedMatched = 0;
    let linkedinMessagesMatched = 0;

    // 3. Process Prospect Replies
    for (const reply of repliesDetected) {
      const fromLower = reply.from.toLowerCase().trim();

      // Find matching lead by message_id_header in References or In-Reply-To, or by sender email
      const { data: matchedLeads } = await adminClient
        .from("leads")
        .select("id, company_id, location_region, full_name, email_status")
        .or(`email.ilike.%${fromLower}%,message_id_header.eq.${reply.inReplyTo || "none"}`)
        .neq("email_status", "replied")
        .limit(1);

      if (matchedLeads && matchedLeads.length > 0) {
        const lead = matchedLeads[0];

        // Immediately stop sequence: email_status = 'replied', clear next_email_at
        await adminClient
          .from("leads")
          .update({
            email_status: "replied",
            next_email_at: null,
            last_contacted_at: reply.date.toISOString(),
          })
          .eq("id", lead.id);

        // Update company status to client or engaged
        if (lead.company_id) {
          await adminClient
            .from("companies")
            .update({
              lock_status: "contacted_cooldown",
              last_contacted_at: reply.date.toISOString(),
            })
            .eq("id", lead.company_id);
        }

        // Log to outreach ledger
        await adminClient.from("outreach_ledger").insert({
          company_id: lead.company_id,
          lead_id: lead.id,
          agent_name: "hostinger_imap_guardian",
          channel: "email",
          event_type: "replied",
          region: lead.location_region,
          summary: `Prospect ${lead.full_name} replied: "${reply.subject}". Outbound sequence paused immediately.`,
          metadata: {
            from: reply.from,
            subject: reply.subject,
            in_reply_to: reply.inReplyTo,
          },
        });

        repliesMatched++;
      }
    }

    // 4. Process Bounces & Circuit Breaker
    for (const bounce of bouncesDetected) {
      let targetEmail = bounce.failedRecipient?.toLowerCase().trim();

      if (!targetEmail) {
        // Try extracting email from bounce subject or reason
        const emailMatch = bounce.reason.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) targetEmail = emailMatch[0].toLowerCase();
      }

      if (targetEmail) {
        const { data: matchedLead } = await adminClient
          .from("leads")
          .select("id, company_id, location_region, full_name")
          .eq("email", targetEmail)
          .maybeSingle();

        if (matchedLead) {
          await adminClient
            .from("leads")
            .update({
              email_status: "bounced",
              email_verification_status: "undeliverable",
              next_email_at: null,
              last_error: bounce.reason,
            })
            .eq("id", matchedLead.id);

          await adminClient.from("outreach_ledger").insert({
            company_id: matchedLead.company_id,
            lead_id: matchedLead.id,
            agent_name: "hostinger_imap_guardian",
            channel: "email",
            event_type: "bounced",
            region: matchedLead.location_region,
            summary: `Hard bounce detected for ${matchedLead.full_name} (${targetEmail}). Auto-marked undeliverable.`,
          });

          bouncesMatched++;
        }
      }
    }

    // 4.5 Process LinkedIn Notification Bridge Alerts
    if (linkedinAlerts && linkedinAlerts.length > 0) {
      const { data: candidateLeads } = await adminClient
        .from("leads")
        .select("*")
        .not("full_name", "is", null)
        .in("linkedin_status", ["pending", "sent", "connected"]);

      for (const alert of linkedinAlerts) {
        const alertLower = alert.rawText.toLowerCase();
        const matchedLead = (candidateLeads || []).find((l) => {
          const name = (l.full_name || "").trim().toLowerCase();
          return name.length >= 4 && alertLower.includes(name);
        });

        if (!matchedLead) continue;

        if (alert.alertType === "accepted" && matchedLead.linkedin_status !== "connected") {
          const dmDraft = await generateZeroPitchPostConnectDm({
            fullName: matchedLead.full_name,
            firstName: matchedLead.first_name,
            title: matchedLead.title,
            company: matchedLead.company,
            targetOffer: matchedLead.target_offer,
            aiEmployeeRole: matchedLead.ai_employee_role,
            enrichmentSummary: matchedLead.enrichment_summary,
          });

          await adminClient
            .from("leads")
            .update({
              linkedin_status: "connected",
              linkedin_dm_delivery: dmDraft,
              last_contacted_at: alert.date.toISOString(),
            })
            .eq("id", matchedLead.id);

          await adminClient.from("outreach_ledger").insert({
            company_id: matchedLead.company_id,
            lead_id: matchedLead.id,
            agent_name: "hostinger_imap_guardian",
            channel: "linkedin_blank_connect",
            event_type: "connected",
            region: matchedLead.location_region,
            city: matchedLead.city,
            summary: `LinkedIn connection accepted by ${matchedLead.full_name} (detected via email alert). Post-connect DM drafted.`,
            metadata: { subject: alert.subject, snippet: alert.snippet },
          });

          linkedinAcceptedMatched++;
        } else if (alert.alertType === "message") {
          await adminClient
            .from("leads")
            .update({
              linkedin_status: "replied",
              last_contacted_at: alert.date.toISOString(),
            })
            .eq("id", matchedLead.id);

          await adminClient.from("outreach_ledger").insert({
            company_id: matchedLead.company_id,
            lead_id: matchedLead.id,
            agent_name: "hostinger_imap_guardian",
            channel: "linkedin_dm",
            event_type: "replied",
            region: matchedLead.location_region,
            city: matchedLead.city,
            summary: `LinkedIn message from ${matchedLead.full_name}: "${alert.snippet.slice(0, 180)}"`,
            metadata: { subject: alert.subject, snippet: alert.snippet },
          });

          linkedinMessagesMatched++;
        }
      }
    }

    // 5. Hard Bounce Circuit Breaker Check (2+ bounces in 24h -> pause sending for 24h)
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentBounces } = await adminClient
      .from("outreach_ledger")
      .select("id")
      .eq("event_type", "bounced")
      .gte("created_at", last24h);

    const totalBouncesIn24h = recentBounces?.length || 0;
    if (totalBouncesIn24h >= 2) {
      const pauseUntil24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      await adminClient
        .from("system_flags")
        .upsert({
          key: "email_paused_until",
          value: {
            until: pauseUntil24h,
            reason: `Circuit Breaker: ${totalBouncesIn24h} hard bounces detected within rolling 24h. Email dispatcher halted for 24 hours.`,
          },
          updated_at: now.toISOString(),
        });
    }

    return NextResponse.json({
      success: true,
      repliesMatched,
      bouncesMatched,
      linkedinAcceptedMatched,
      linkedinMessagesMatched,
      totalBouncesIn24h,
      circuitBreakerTripped: totalBouncesIn24h >= 2,
    });
  } catch (err: any) {
    console.error("Cron sync-imap fatal error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to sync IMAP" },
      { status: 500 }
    );
  }
}
