import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

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

    const { leadId, reason } = await req.json();
    if (!leadId) {
      return NextResponse.json({ error: "Missing leadId" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    const { data: lead } = await adminClient
      .from("leads")
      .select("id, company_id, location_region, full_name, company")
      .eq("id", leadId)
      .single();

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // 1. Mark lead as rejected and archived
    await adminClient
      .from("leads")
      .update({
        email_status: "rejected",
        vault_stage: "archived",
      })
      .eq("id", leadId);

    // 2. Save rejection rule lesson to agent memory
    await adminClient.from("agent_memory_episodes").insert({
      agent_name: "head_outreach_agent",
      region: lead.location_region,
      lesson_type: "rejection_rule",
      lesson_text: reason || `Executive rejected outreach for ${lead.company || lead.full_name}: poor fit or timing.`,
    });

    // 3. Log to outreach ledger
    await adminClient.from("outreach_ledger").insert({
      company_id: lead.company_id,
      lead_id: leadId,
      agent_name: "head_outreach_agent",
      channel: "email",
      event_type: "rejected",
      region: lead.location_region,
      summary: `Rejected by Seshank: ${reason || "Manual rejection during review"}`,
    });

    return NextResponse.json({ success: true, leadId, status: "rejected" });
  } catch (err: any) {
    console.error("Approval reject error:", err);
    return NextResponse.json({ error: err.message || "Failed to reject lead" }, { status: 500 });
  }
}
