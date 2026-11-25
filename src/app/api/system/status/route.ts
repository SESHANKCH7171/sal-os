import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
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

    const adminClient = createAdminClient();
    const now = new Date();
    const todayDate = now.toISOString().split("T")[0];
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: flags },
      { data: usageLogs },
      { data: allLeads },
      { data: ledger },
      { data: recentEmailSends },
      { data: linkedinDmRows },
    ] = await Promise.all([
      adminClient.from("system_flags").select("*"),
      adminClient.from("api_usage_logs").select("*").eq("usage_date", todayDate),
      adminClient
        .from("leads")
        .select(
          "id, full_name, company, title, email, email_subject, email_status, linkedin_status, last_contacted_at, location_region, target_offer, jev_icp_qualified, normalized_linkedin_url, linkedin_url"
        )
        .order("created_at", { ascending: false }),
      adminClient
        .from("outreach_ledger")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(60),
      adminClient
        .from("outreach_ledger")
        .select("id")
        .eq("channel", "email")
        .in("event_type", ["step1_sent", "followup_sent"])
        .gte("created_at", last24h),
      adminClient
        .from("outreach_ledger")
        .select("lead_id")
        .eq("channel", "linkedin_dm"),
    ]);

    const linkedinDmSentLeadIds = new Set(
      (linkedinDmRows || []).map((r: any) => r.lead_id).filter(Boolean)
    );

    const flagsMap: Record<string, any> = {};
    for (const f of flags || []) {
      flagsMap[f.key] = f.value;
    }

    const leadsList = allLeads || [];
    const awaitingGreenLight = leadsList.filter(
      (l) => l.email_status === "awaiting_green_light"
    ).length;
    const linkedinPending = leadsList.filter(
      (l) =>
        Boolean(l.jev_icp_qualified) &&
        Boolean(l.normalized_linkedin_url || l.linkedin_url) &&
        (!l.linkedin_status || l.linkedin_status === "pending")
    ).length;
    const linkedinAwaitingAcceptance = leadsList.filter(
      (l) =>
        Boolean(l.normalized_linkedin_url || l.linkedin_url) &&
        l.linkedin_status === "sent" &&
        !linkedinDmSentLeadIds.has(l.id)
    ).length;
    const linkedinConnected = leadsList.filter(
      (l) => l.linkedin_status === "connected" || l.linkedin_status === "replied"
    ).length;

    const repliesCount = leadsList.filter(
      (l) => l.email_status === "replied" || l.linkedin_status === "replied"
    ).length;
    const bouncesCount = leadsList.filter((l) => l.email_status === "bounced").length;
    const needsReplyLeads = leadsList.filter(
      (l) => l.email_status === "replied" || l.linkedin_status === "replied"
    );

    const dailyEmailCap = parseInt(process.env.DAILY_EMAIL_CAP || "10", 10);
    const dryRunEmails = process.env.DRY_RUN_EMAILS === "true";

    return NextResponse.json({
      success: true,
      dryRunEmails,
      dailyEmailCap,
      rolling24hEmailsSent: recentEmailSends?.length || 0,
      dailyPlan: flagsMap["daily_outreach_plan"] || null,
      emailPausedFlag: flagsMap["email_paused_until"] || null,
      usageLogs: usageLogs || [],
      kpis: {
        awaitingGreenLight,
        linkedinPending,
        linkedinAwaitingAcceptance,
        linkedinConnected,
        repliesCount,
        bouncesCount,
      },
      ledger: ledger || [],
      needsReplyLeads,
    });
  } catch (err: any) {
    console.error("System status error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to load command center status" },
      { status: 500 }
    );
  }
}
