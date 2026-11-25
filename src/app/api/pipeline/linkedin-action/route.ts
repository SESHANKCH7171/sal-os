import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Handles LinkedIn status updates & ledger logging using adminClient
 * Enforcing schema.sql constraints:
 * leads.linkedin_status in ('pending', 'sent', 'connected', 'accepted', 'awaiting_green_light', 'green_lit', 'replied', 'skipped')
 * outreach_ledger.channel in ('email', 'linkedin_blank_connect', 'linkedin_dm', 'system')
 * outreach_ledger.event_type in ('historical_sent', 'drafted', 'green_lit', 'step1_sent', 'followup_sent', 'connected', 'replied', 'bounced', 'rejected')
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const allowedEmail = (
      process.env.ALLOWED_USER_EMAIL || "seshank@seshankailabs.com"
    ).toLowerCase().trim();

    if (!user || user.email?.toLowerCase().trim() !== allowedEmail) {
      return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
    }

    const { action, leadId } = await req.json();
    if (!action || !leadId) {
      return NextResponse.json({ error: "Missing action or leadId" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    const { data: lead, error: fetchErr } = await adminClient
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (fetchErr || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    if (action === "mark_blank_connect_sent") {
      // In schema.sql:
      // linkedin_status = 'sent' with last_contacted_at = null represents Blank Connect Sent (Awaiting Acceptance)
      const { error: updateErr } = await adminClient
        .from("leads")
        .update({
          linkedin_status: "sent",
          last_contacted_at: null,
        })
        .eq("id", leadId);

      if (updateErr) {
        console.error("Failed to update lead linkedin_status to sent:", updateErr);
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      const { error: ledgerErr } = await adminClient.from("outreach_ledger").insert({
        company_id: lead.company_id,
        lead_id: leadId,
        agent_name: "head_outreach_agent",
        channel: "linkedin_blank_connect",
        event_type: "step1_sent",
        region: lead.location_region,
        city: lead.city,
        summary: `Blank connection request sent on LinkedIn to ${lead.full_name}.`,
      });

      if (ledgerErr) {
        console.error("Failed to write to outreach_ledger:", ledgerErr);
      }

      return NextResponse.json({ success: true, leadId, linkedin_status: "sent" });
    }

    if (action === "mark_dm_sent") {
      const { error: updateErr } = await adminClient
        .from("leads")
        .update({
          linkedin_status: "sent",
          last_contacted_at: new Date().toISOString(),
        })
        .eq("id", leadId);

      if (updateErr) {
        console.error("Failed to update lead linkedin_status for dm sent:", updateErr);
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      const { error: ledgerErr } = await adminClient.from("outreach_ledger").insert({
        company_id: lead.company_id,
        lead_id: leadId,
        agent_name: "head_outreach_agent",
        channel: "linkedin_dm",
        event_type: "step1_sent",
        region: lead.location_region,
        city: lead.city,
        summary: `Post-connect LinkedIn message delivered to ${lead.full_name}.`,
      });

      if (ledgerErr) {
        console.error("Failed to write to outreach_ledger:", ledgerErr);
      }

      return NextResponse.json({ success: true, leadId, linkedin_status: "sent" });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error("LinkedIn action error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to process LinkedIn action" },
      { status: 500 }
    );
  }
}
