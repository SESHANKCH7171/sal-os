import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchHostingerSentEmails } from "@/lib/email/hostinger-imap";

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

    const emails = await fetchHostingerSentEmails(25);
    return NextResponse.json({ success: true, emails });
  } catch (err: any) {
    console.error("Hostinger sent-history error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to read Hostinger Sent mailbox" },
      { status: 500 }
    );
  }
}
