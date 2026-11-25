import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateZeroPitchPostConnectDm } from "@/lib/ai/linkedin-dm";

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

    const { leadId } = await req.json();
    if (!leadId) {
      return NextResponse.json({ error: "Missing leadId" }, { status: 400 });
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

    // Draft zero-pitch, <40 word post-connect DM
    const dmDraft = await generateZeroPitchPostConnectDm({
      fullName: lead.full_name,
      firstName: lead.first_name,
      title: lead.title,
      company: lead.company,
      targetOffer: lead.target_offer,
      aiEmployeeRole: lead.ai_employee_role,
      enrichmentSummary: lead.enrichment_summary,
    });

    // Set linkedin_status to 'connected' and save drafted DM
    const { error: updateErr } = await adminClient
      .from("leads")
      .update({
        linkedin_status: "connected",
        linkedin_dm_delivery: dmDraft,
        last_contacted_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    if (updateErr) {
      console.error("Failed to update linkedin_status to connected:", updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Log connected event in outreach_ledger
    const { error: ledgerErr } = await adminClient.from("outreach_ledger").insert({
      company_id: lead.company_id,
      lead_id: leadId,
      agent_name: "head_outreach_agent",
      channel: "linkedin_blank_connect",
      event_type: "connected",
      region: lead.location_region,
      city: lead.city,
      summary: `LinkedIn Connection Accepted by ${lead.full_name}. Zero-pitch post-connect DM ready.`,
    });

    if (ledgerErr) {
      console.error("Failed to log connected event to outreach_ledger:", ledgerErr);
    }

    return NextResponse.json({
      success: true,
      leadId,
      linkedin_status: "connected",
      linkedin_dm_delivery: dmDraft,
    });
  } catch (err: any) {
    console.error("On linkedin connected error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to handle connected event" },
      { status: 500 }
    );
  }
}
