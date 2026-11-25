import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOutreachEmail } from "@/lib/email/hostinger-smtp";
import { getNextValidWorkdayWindow } from "@/lib/email/timezone-window";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleCronSend(req);
}

export async function GET(req: NextRequest) {
  return handleCronSend(req);
}

async function handleCronSend(req: NextRequest) {
  try {
    // 1. Strict Cron Secret Authentication
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized cron execution." }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const now = new Date();

    // 2. Check Hostinger Circuit Breaker in system_flags
    const { data: pauseFlag } = await adminClient
      .from("system_flags")
      .select("value")
      .eq("key", "email_paused_until")
      .maybeSingle();

    if (pauseFlag?.value?.until) {
      const pauseUntil = new Date(pauseFlag.value.until);
      if (pauseUntil > now) {
        return NextResponse.json({
          status: "circuit_breaker_paused",
          message: `Outreach paused until ${pauseUntil.toISOString()} (${pauseFlag.value.reason || "Circuit breaker active"})`,
        });
      }
    }

    // 2.5 Check Jev Daily Outreach Plan in system_flags
    const { data: planFlag } = await adminClient
      .from("system_flags")
      .select("value")
      .eq("key", "daily_outreach_plan")
      .maybeSingle();

    const dailyPlan = planFlag?.value as
      | {
          is_rest_day?: boolean;
          active_email_regions?: string[];
          paused_email_regions?: Array<{ region: string; reason: string }>;
        }
      | undefined;

    if (dailyPlan?.is_rest_day === true) {
      return NextResponse.json({
        status: "rest_day_paused",
        message: "Saturday Rest Day active in daily_outreach_plan. Email dispatch paused.",
      });
    }

    const activeRegions =
      dailyPlan?.active_email_regions && dailyPlan.active_email_regions.length > 0
        ? dailyPlan.active_email_regions
        : null;

    // 3. Check Rolling 24-Hour Send Cap against DAILY_EMAIL_CAP
    const dailyCap = parseInt(process.env.DAILY_EMAIL_CAP || "10", 10);
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentSends } = await adminClient
      .from("outreach_ledger")
      .select("id")
      .eq("channel", "email")
      .in("event_type", ["step1_sent", "followup_sent"])
      .gte("created_at", last24h);

    const sendsCount = recentSends?.length || 0;
    if (sendsCount >= dailyCap) {
      return NextResponse.json({
        status: "daily_cap_reached",
        message: `Rolling 24h cap reached: ${sendsCount}/${dailyCap} emails sent. Throttling active.`,
      });
    }

    // 4. Atomically Claim Exactly 1 Lead with 10-minute stale-lock recovery
    // Follow-Up Priority Rule: order strictly by current_email_step DESC, next_email_at ASC
    // so due Day 3 (step 1->2) and Day 7 (step 2->3) follow-ups ALWAYS claim slots before new Step 1 leads.
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

    const { data: candidateLeads, error: queryErr } = await adminClient
      .from("leads")
      .select("*")
      .in("email_status", ["green_lit", "step1_sent", "step2_sent"])
      .lte("next_email_at", now.toISOString())
      .or(`sending_locked_at.is.null,sending_locked_at.lt.${tenMinutesAgo}`)
      .order("current_email_step", { ascending: false })
      .order("next_email_at", { ascending: true })
      .limit(20);

    if (queryErr) {
      throw queryErr;
    }

    let lead: any = null;
    for (const candidate of candidateLeads || []) {
      const candidateRegion = (candidate.location_region || "OTHER").toUpperCase();
      if (
        activeRegions &&
        ["US", "UK", "UAE", "KSA"].includes(candidateRegion) &&
        !activeRegions.includes(candidateRegion)
      ) {
        // Region is paused today (weekend or public holiday) -> bump next_email_at to next valid workday
        const bumpedWindow = getNextValidWorkdayWindow(candidateRegion as any, 1);
        await adminClient
          .from("leads")
          .update({ next_email_at: bumpedWindow })
          .eq("id", candidate.id);
        continue;
      }
      lead = candidate;
      break;
    }

    if (!lead) {
      return NextResponse.json({
        status: "idle",
        message: activeRegions
          ? `No scheduled emails currently due for active regions (${activeRegions.join(", ")}).`
          : "No scheduled emails currently due for dispatch.",
      });
    }

    // Atomically claim lead with send lock (NEVER overwrite email_status with 'sending')
    await adminClient
      .from("leads")
      .update({ sending_locked_at: now.toISOString() })
      .eq("id", lead.id);

    const isDryRun = process.env.DRY_RUN_EMAILS === "true";
    const currentStep = lead.current_email_step || 0;
    const region = (lead.location_region || "OTHER") as any;

    // 5. Handle DRY_RUN_EMAILS = true
    if (isDryRun) {
      await adminClient.from("outreach_ledger").insert({
        company_id: lead.company_id,
        lead_id: lead.id,
        agent_name: "hostinger_smtp_cron",
        channel: "email",
        event_type: "drafted",
        region: lead.location_region,
        summary: `[DRY RUN] Would send Step ${currentStep + 1} email to ${lead.email} (${lead.email_subject}).`,
        metadata: {
          dry_run: true,
          step: currentStep + 1,
          to: lead.email,
        },
      });

      // Clear lock without sending
      await adminClient
        .from("leads")
        .update({ sending_locked_at: null })
        .eq("id", lead.id);

      return NextResponse.json({
        status: "dry_run_dispatched",
        leadId: lead.id,
        to: lead.email,
        step: currentStep + 1,
        message: "Dry run mode active. No SMTP traffic emitted.",
      });
    }

    // 6. Live Send via Hostinger SMTP
    let subject = lead.email_subject || "Quick inquiry";
    let body = lead.email_step1 || "";
    let inReplyTo: string | undefined = undefined;
    let references: string[] | undefined = undefined;
    let newStep = 1;
    let newStatus = "step1_sent";
    let nextWindow: string | null = null;
    let eventType = "step1_sent";

    if (currentStep === 0 || lead.email_status === "green_lit") {
      // Step 1: Initial Cold Outreach (< 65w)
      body = lead.email_step1;
      newStep = 1;
      newStatus = "step1_sent";
      nextWindow = getNextValidWorkdayWindow(region, 3); // 3-day follow-up
      eventType = "step1_sent";
    } else if (currentStep === 1) {
      // Step 2: Gentle Bump (Day 3) Threaded
      subject = subject.startsWith("Re: ") ? subject : `Re: ${subject}`;
      body = lead.email_step2_followup || "Quick bump on this.";
      inReplyTo = lead.message_id_header || undefined;
      references = lead.message_id_header ? [lead.message_id_header] : undefined;
      newStep = 2;
      newStatus = "step2_sent";
      nextWindow = getNextValidWorkdayWindow(region, 4); // 4 more days (Day 7 total)
      eventType = "followup_sent";
    } else if (currentStep === 2) {
      // Step 3: Breakup / Free Value (Day 7) Threaded
      subject = subject.startsWith("Re: ") ? subject : `Re: ${subject}`;
      body = lead.email_step3_followup || "Closing the loop here.";
      inReplyTo = lead.message_id_header || undefined;
      references = lead.message_id_header ? [lead.message_id_header] : undefined;
      newStep = 3;
      newStatus = "step3_sent";
      nextWindow = null; // Sequence complete
      eventType = "followup_sent";
    }

    try {
      const sendResult = await sendOutreachEmail({
        to: lead.email,
        subject,
        text: body,
        inReplyTo,
        references,
      });

      // Update lead state
      await adminClient
        .from("leads")
        .update({
          current_email_step: newStep,
          email_status: newStatus,
          message_id_header: lead.message_id_header || sendResult.messageId,
          next_email_at: nextWindow,
          last_contacted_at: now.toISOString(),
          sending_locked_at: null,
          last_error: null,
        })
        .eq("id", lead.id);

      // Lock company with 90-day cooldown
      if (lead.company_id) {
        const cooldown90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
        await adminClient
          .from("companies")
          .update({
            lock_status: "contacted_cooldown",
            last_contacted_at: now.toISOString(),
            cooldown_until: cooldown90Days,
          })
          .eq("id", lead.company_id);
      }

      // Record in immutable ledger
      await adminClient.from("outreach_ledger").insert({
        company_id: lead.company_id,
        lead_id: lead.id,
        agent_name: "hostinger_smtp_cron",
        channel: "email",
        event_type: eventType,
        region: lead.location_region,
        summary: `Dispatched Step ${newStep} email to ${lead.email} (${subject}).`,
        metadata: {
          step: newStep,
          message_id: sendResult.messageId,
          next_scheduled: nextWindow,
        },
      });

      return NextResponse.json({
        status: "email_sent",
        leadId: lead.id,
        step: newStep,
        to: lead.email,
        messageId: sendResult.messageId,
      });
    } catch (sendErr: any) {
      console.error(`Error sending email to lead ${lead.id}:`, sendErr);

      // Check if SMTP temporary error (421, 450, 451) -> trip 6h circuit breaker
      if (sendErr?.isSmtpTemporaryError) {
        const pauseUntil6h = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
        await adminClient
          .from("system_flags")
          .upsert({
            key: "email_paused_until",
            value: { until: pauseUntil6h, reason: sendErr.message },
            updated_at: now.toISOString(),
          });
      }

      // Release lock and note error
      await adminClient
        .from("leads")
        .update({
          sending_locked_at: null,
          last_error: sendErr.message,
        })
        .eq("id", lead.id);

      throw sendErr;
    }
  } catch (err: any) {
    console.error("Cron send-emails fatal error:", err);
    return NextResponse.json(
      { error: err.message || "Failed cron execution" },
      { status: 500 }
    );
  }
}
