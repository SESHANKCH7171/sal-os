import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOutreachEmail } from "@/lib/email/hostinger-smtp";

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

    const { leadId, subject, body } = await req.json();
    if (!leadId || !body) {
      return NextResponse.json({ error: "Missing leadId or body" }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (leadErr || !lead || !lead.email) {
      return NextResponse.json(
        { error: "Lead or lead email not found" },
        { status: 404 }
      );
    }

    const cleanBody = body.replace(/[\u2014\u2013]/g, ", ").replace(/\s*--\s*/g, ", ");
    const replySubject =
      subject ||
      (lead.email_subject?.startsWith("Re: ")
        ? lead.email_subject
        : `Re: ${lead.email_subject || "Quick follow-up"}`);

    const sendResult = await sendOutreachEmail({
      to: lead.email,
      subject: replySubject,
      text: cleanBody,
      inReplyTo: lead.message_id_header || undefined,
      references: lead.message_id_header ? [lead.message_id_header] : undefined,
    });

    await adminClient
      .from("leads")
      .update({ last_contacted_at: new Date().toISOString() })
      .eq("id", lead.id);

    await adminClient.from("outreach_ledger").insert({
      company_id: lead.company_id,
      lead_id: lead.id,
      agent_name: "head_outreach_agent",
      channel: "email",
      event_type: "followup_sent",
      region: lead.location_region,
      city: lead.city,
      summary: `Dispatched threaded reply to ${lead.full_name} (${lead.email}).`,
      metadata: {
        subject: replySubject,
        message_id: sendResult.messageId,
      },
    });

    return NextResponse.json({
      success: true,
      messageId: sendResult.messageId,
    });
  } catch (err: any) {
    console.error("Send reply error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to send threaded reply" },
      { status: 500 }
    );
  }
}
