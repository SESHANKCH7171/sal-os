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

    const { pause } = await req.json();
    const adminClient = createAdminClient();
    const now = new Date();

    if (pause) {
      // Pause for 24 hours (manual executive pause)
      const pauseUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const { error } = await adminClient.from("system_flags").upsert({
        key: "email_paused_until",
        value: {
          until: pauseUntil,
          reason: "Manual Executive Pause from Command Center",
          manual: true,
        },
        updated_at: now.toISOString(),
      });
      if (error) throw error;

      return NextResponse.json({
        success: true,
        paused: true,
        until: pauseUntil,
      });
    } else {
      // Resume immediately
      const { error } = await adminClient.from("system_flags").upsert({
        key: "email_paused_until",
        value: {
          until: null,
          reason: "Resumed by Executive",
          manual: false,
        },
        updated_at: now.toISOString(),
      });
      if (error) throw error;

      return NextResponse.json({
        success: true,
        paused: false,
        until: null,
      });
    }
  } catch (err: any) {
    console.error("Toggle pause error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to toggle email pause" },
      { status: 500 }
    );
  }
}
