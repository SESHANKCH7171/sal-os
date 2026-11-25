import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLiveHolidayRadar, TargetRegion } from "@/lib/calendar/live-holiday-radar";
import { incrementQuota } from "@/lib/enrichment/quota-tracker";
import { z } from "zod";

export const dynamic = "force-dynamic";

const DailyOutreachPlanSchema = z.object({
  date: z.string(),
  day_name: z.string(),
  is_rest_day: z.boolean(),
  active_email_regions: z.array(z.enum(["US", "UK", "UAE", "KSA"])),
  paused_email_regions: z.array(
    z.object({
      region: z.enum(["US", "UK", "UAE", "KSA"]),
      reason: z.string(),
    })
  ),
  skip_us_cold_step1_morning: z.boolean().default(false),
  linkedin_daily_spread: z.object({
    US: z.number().int().min(0),
    UK: z.number().int().min(0),
    UAE: z.number().int().min(0),
    KSA: z.number().int().min(0),
  }),
  strategy_summary: z.string(),
});

export type DailyOutreachPlan = z.infer<typeof DailyOutreachPlanSchema>;

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const allowedEmail = (
      process.env.ALLOWED_USER_EMAIL || "seshank@seshankailabs.com"
    ).toLowerCase().trim();
    return Boolean(user && user.email?.toLowerCase().trim() === allowedEmail);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  return handleDailyStrategy(req);
}

export async function GET(req: NextRequest) {
  return handleDailyStrategy(req);
}

async function handleDailyStrategy(req: NextRequest) {
  try {
    if (!(await isAuthorized(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const radar = await getLiveHolidayRadar();

    // Fetch pending email & linkedin lead counts per region
    const { data: pendingLeads } = await adminClient
      .from("leads")
      .select("location_region, email_status, linkedin_status, jev_icp_qualified")
      .or("email_status.in.(green_lit,step1_sent,step2_sent),linkedin_status.eq.pending");

    const counts: Record<TargetRegion, { emailDue: number; linkedinPending: number }> = {
      US: { emailDue: 0, linkedinPending: 0 },
      UK: { emailDue: 0, linkedinPending: 0 },
      UAE: { emailDue: 0, linkedinPending: 0 },
      KSA: { emailDue: 0, linkedinPending: 0 },
    };

    for (const l of pendingLeads || []) {
      const r = (l.location_region || "").toUpperCase() as TargetRegion;
      if (!counts[r]) continue;
      if (["green_lit", "step1_sent", "step2_sent"].includes(l.email_status)) {
        counts[r].emailDue++;
      }
      if (l.jev_icp_qualified && (!l.linkedin_status || l.linkedin_status === "pending")) {
        counts[r].linkedinPending++;
      }
    }

    // Build deterministic baseline + holiday overrides first
    const istDow = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    ).getDay();

    const pausedMap = new Map<TargetRegion, string>();
    const allRegions: TargetRegion[] = ["US", "UK", "UAE", "KSA"];

    // Check holidays from radar
    for (const r of allRegions) {
      const info = radar.regions[r];
      if (info.holidaysToday.length > 0) {
        pausedMap.set(r, `Public holiday: ${info.holidaysToday.join(", ")}`);
      } else if (info.nagerPublicHolidayToday) {
        pausedMap.set(r, `Public holiday: ${info.nagerPublicHolidayToday}`);
      } else if (info.inLongWeekendBridge && info.longWeekendReason) {
        pausedMap.set(r, info.longWeekendReason);
      }
    }

    let isRestDay = false;
    let baselineActive: TargetRegion[] = [];
    let skipUsMorning = false;

    if (istDow === 6) {
      // Saturday: HARD ZERO
      isRestDay = true;
      baselineActive = [];
      for (const r of allRegions) {
        if (!pausedMap.has(r)) pausedMap.set(r, "Saturday hard rest day");
      }
    } else if (istDow === 0) {
      // Sunday: KSA only
      baselineActive = ["KSA"];
      for (const r of ["US", "UK", "UAE"] as TargetRegion[]) {
        if (!pausedMap.has(r)) pausedMap.set(r, "Sunday: KSA-only workday");
      }
    } else if (istDow === 5) {
      // Friday: UK & US only
      baselineActive = ["UK", "US"];
      for (const r of ["KSA", "UAE"] as TargetRegion[]) {
        if (!pausedMap.has(r)) pausedMap.set(r, "Friday: GCC weekend (UK & US only)");
      }
    } else if (istDow === 1) {
      // Monday: UAE + UK priority, skip US cold Step 1 on Monday AM
      baselineActive = ["UAE", "UK", "KSA", "US"];
      skipUsMorning = true;
    } else {
      // Tue-Thu: US #1 + UK/GCC (GCC AM only on Thu)
      baselineActive = ["US", "UK", "UAE", "KSA"];
    }

    // Remove any holiday-paused regions from baselineActive
    const finalBaselineActive = baselineActive.filter((r) => !pausedMap.has(r));

    const defaultPlan: DailyOutreachPlan = {
      date: radar.istDate,
      day_name: radar.istDayName,
      is_rest_day: isRestDay,
      active_email_regions: isRestDay ? [] : finalBaselineActive,
      paused_email_regions: Array.from(pausedMap.entries()).map(([region, reason]) => ({
        region,
        reason,
      })),
      skip_us_cold_step1_morning: skipUsMorning,
      linkedin_daily_spread: isRestDay
        ? { US: 0, UK: 0, UAE: 0, KSA: 0 }
        : {
            US: finalBaselineActive.includes("US") ? (istDow === 5 ? 10 : 6) : 0,
            UK: finalBaselineActive.includes("UK") ? (istDow === 5 ? 5 : 5) : 0,
            UAE: finalBaselineActive.includes("UAE") ? 5 : 0,
            KSA: finalBaselineActive.includes("KSA") ? (istDow === 0 ? 20 : 4) : 0,
          },
      strategy_summary: isRestDay
        ? "Saturday Rest Day: All automated email and LinkedIn outreach is paused."
        : `Active regions: ${finalBaselineActive.join(", ") || "None"}. ${
            pausedMap.size > 0
              ? `Paused: ${Array.from(pausedMap.entries())
                  .map(([r, msg]) => `${r} (${msg})`)
                  .join("; ")}.`
              : "No active regional holidays."
          }`,
    };

    // Ask Jev (Mesh API / Gemini fallback) to refine strategy & summary
    let finalPlan: DailyOutreachPlan = defaultPlan;
    const meshKey = process.env.MESH_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    const prompt = `You are Jev, the Strategic Operations Agent for Seshank AI Labs.
Live Holiday Radar Snapshot:
${JSON.stringify(radar, null, 2)}

Current Pending Leads by Region:
${JSON.stringify(counts, null, 2)}

Mandatory Rules:
1. Saturday = HARD ZERO (is_rest_day: true, active_email_regions: [], linkedin_daily_spread all 0).
2. Sunday = KSA only (active_email_regions: ["KSA"]).
3. Friday = UK & US only (zero KSA/UAE).
4. Monday = UAE + UK priority (skip_us_cold_step1_morning: true); Tue-Thu = US #1 + UK/GCC.
5. Any region with an active public holiday or long-weekend bridge in the snapshot MUST be moved to paused_email_regions with the exact holiday reason.
6. NEVER pause or exclude a region just because its pending lead count is 0. Active regions MUST strictly follow the Day-of-Week + Holiday calendar.

Return ONLY valid JSON matching:
{
  "date": "${radar.istDate}",
  "day_name": "${radar.istDayName}",
  "is_rest_day": boolean,
  "active_email_regions": ["US"|"UK"|"UAE"|"KSA"],
  "paused_email_regions": [{"region": "US"|"UK"|"UAE"|"KSA", "reason": "string"}],
  "skip_us_cold_step1_morning": boolean,
  "linkedin_daily_spread": {"US": number, "UK": number, "UAE": number, "KSA": number},
  "strategy_summary": "concise 1-2 sentence executive briefing (zero em dashes)"
}`;

    try {
      let rawJson: string | null = null;

      if (meshKey) {
        await incrementQuota("mesh_jev");
        const res = await fetch(
          `${process.env.MESH_API_BASE_URL || "https://api.meshapi.ai/v1"}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${meshKey}`,
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [
                { role: "system", content: "Output strict JSON only." },
                { role: "user", content: prompt },
              ],
              response_format: { type: "json_object" },
            }),
            signal: AbortSignal.timeout(8000),
          }
        );
        if (res.ok) {
          const data = await res.json();
          rawJson = data.choices?.[0]?.message?.content || null;
        }
      }

      if (!rawJson && geminiKey) {
        await incrementQuota("gemini_text");
        const model = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
            }),
            signal: AbortSignal.timeout(8000),
          }
        );
        if (res.ok) {
          const data = await res.json();
          rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
        }
      }

      if (rawJson) {
        const parsed = DailyOutreachPlanSchema.parse(JSON.parse(rawJson));
        // Enforce deterministic hard guardrails on top of Jev's output
        // Active regions strictly follow Day-of-Week + Holiday calendar (never dropped for 0 pending leads)
        finalPlan = {
          ...parsed,
          is_rest_day: isRestDay || parsed.is_rest_day,
          active_email_regions: isRestDay ? [] : finalBaselineActive,
          paused_email_regions: defaultPlan.paused_email_regions,
          strategy_summary: parsed.strategy_summary.replace(/[\u2014\u2013]/g, ", "),
        };
      }
    } catch (aiErr: any) {
      console.warn("Jev daily strategy AI fallback to deterministic plan:", aiErr.message);
    }

    // Save into system_flags under key 'daily_outreach_plan'
    const payloadToSave = {
      ...finalPlan,
      radar_snapshot: radar,
      pending_counts: counts,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await adminClient.from("system_flags").upsert({
      key: "daily_outreach_plan",
      value: payloadToSave,
      updated_at: new Date().toISOString(),
    });

    if (upsertErr) {
      throw upsertErr;
    }

    return NextResponse.json({
      success: true,
      plan: payloadToSave,
    });
  } catch (err: any) {
    console.error("Daily strategy cron error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate daily outreach strategy" },
      { status: 500 }
    );
  }
}
