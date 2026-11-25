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

    const { leadId, companyId, reason } = await req.json();
    if (!leadId) {
      return NextResponse.json({ error: "Missing leadId" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 1. Permanently lock company to do_not_contact
    if (companyId) {
      await adminClient
        .from("companies")
        .update({
          lock_status: "do_not_contact",
          notes: reason || "Opt-out / DNC requested by executive",
        })
        .eq("id", companyId);
    }

    // 2. Reject and archive the lead across both channels
    await adminClient
      .from("leads")
      .update({
        email_status: "rejected",
        linkedin_status: "skipped",
        vault_stage: "archived",
      })
      .eq("id", leadId);

    // 3. Log to outreach ledger
    await adminClient.from("outreach_ledger").insert({
      company_id: companyId || null,
      lead_id: leadId,
      agent_name: "head_outreach_agent",
      channel: "system",
      event_type: "rejected",
      summary: `Marked DNC (Do Not Contact): ${reason || "Permanent opt-out applied"}`,
    });

    return NextResponse.json({ success: true, leadId, lock_status: "do_not_contact" });
  } catch (err: any) {
    console.error("DNC error:", err);
    return NextResponse.json({ error: err.message || "Failed to mark DNC" }, { status: 500 });
  }
}
