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

    const { active_email_regions, is_rest_day } = await req.json();
    const adminClient = createAdminClient();

    const { data: existing } = await adminClient
      .from("system_flags")
      .select("value")
      .eq("key", "daily_outreach_plan")
      .maybeSingle();

    const currentPlan = (existing?.value as Record<string, any>) || {
      date: new Date().toISOString().split("T")[0],
      day_name: new Date().toLocaleDateString("en-US", { weekday: "long" }),
      is_rest_day: false,
      active_email_regions: ["US", "UK", "UAE", "KSA"],
      paused_email_regions: [],
      linkedin_daily_spread: { US: 6, UK: 5, UAE: 5, KSA: 4 },
    };

    const updatedActive = Array.isArray(active_email_regions)
      ? active_email_regions
      : currentPlan.active_email_regions || [];

    const allRegions = ["US", "UK", "UAE", "KSA"];
    const updatedPaused = allRegions
      .filter((r) => !updatedActive.includes(r))
      .map((r) => {
        const prev = (currentPlan.paused_email_regions || []).find((p: any) => p.region === r);
        return {
          region: r,
          reason: prev?.reason || "Manually toggled off by executive",
        };
      });

    const updatedPlan = {
      ...currentPlan,
      is_rest_day: typeof is_rest_day === "boolean" ? is_rest_day : currentPlan.is_rest_day,
      active_email_regions: updatedActive,
      paused_email_regions: updatedPaused,
      manual_override: true,
      updated_at: new Date().toISOString(),
    };

    const { error } = await adminClient.from("system_flags").upsert({
      key: "daily_outreach_plan",
      value: updatedPlan,
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;

    return NextResponse.json({ success: true, plan: updatedPlan });
  } catch (err: any) {
    console.error("Override regions error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to override regions" },
      { status: 500 }
    );
  }
}
