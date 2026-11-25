import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNextValidWorkdayWindow } from "@/lib/email/timezone-window";

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

    const body = await req.json();
    const {
      leadId,
      email_subject,
      email_step1,
      email_step2_followup,
      email_step3_followup,
      isEdited,
      manualEditNote,
    } = body;

    if (!leadId) {
      return NextResponse.json({ error: "Missing leadId" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Fetch existing lead to check region & company
    const { data: lead, error: fetchErr } = await adminClient
      .from("leads")
      .select("id, company_id, location_region, email_step1, full_name, company")
      .eq("id", leadId)
      .single();

    if (fetchErr || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const region = (lead.location_region || "OTHER") as any;
    const nextWindow = getNextValidWorkdayWindow(region, 0);

    // 1. If Seshank edited the draft copy, save a style correction lesson to agent memory
    if (isEdited) {
      await adminClient.from("agent_memory_episodes").insert({
        agent_name: "head_outreach_agent",
        region: lead.location_region,
        lesson_type: "style_correction",
        lesson_text:
          manualEditNote ||
          `Executive refined Step 1 draft for ${lead.company || lead.full_name}: prioritized direct peer phrasing and deleted fluff.`,
      });
    }

    // 2. Set email_status = 'green_lit', update edited copies, schedule next_email_at
    const { error: updateErr } = await adminClient
      .from("leads")
      .update({
        email_status: "green_lit",
        email_subject: email_subject || undefined,
        email_step1: email_step1 || undefined,
        email_step2_followup: email_step2_followup || undefined,
        email_step3_followup: email_step3_followup || undefined,
        next_email_at: nextWindow,
        vault_stage: "active",
        needs_human_review: false,
      })
      .eq("id", leadId);

    if (updateErr) {
      throw updateErr;
    }

    // 3. Lock company status to 'in_progress'
    if (lead.company_id) {
      await adminClient
        .from("companies")
        .update({
          lock_status: "in_progress",
          last_contacted_at: new Date().toISOString(),
        })
        .eq("id", lead.company_id);
    }

    // 4. Log green_lit to immutable outreach ledger
    await adminClient.from("outreach_ledger").insert({
      company_id: lead.company_id,
      lead_id: leadId,
      agent_name: "head_outreach_agent",
      channel: "email",
      event_type: "green_lit",
      region: lead.location_region,
      summary: `Green Light granted by Seshank for ${lead.full_name}. Scheduled for ${nextWindow}.`,
      metadata: {
        was_edited: Boolean(isEdited),
        scheduled_for: nextWindow,
      },
    });

    return NextResponse.json({
      success: true,
      leadId,
      email_status: "green_lit",
      next_email_at: nextWindow,
    });
  } catch (err: any) {
    console.error("Green light approval error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to give green light" },
      { status: 500 }
    );
  }
}
