import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

    const recipient = allowedEmail;
    const testResult = await sendOutreachEmail({
      to: recipient,
      subject: "Seshank AI Labs OS: Hostinger SMTP Verification Test",
      text: "This is a verified test email sent from Seshank AI Labs OS to verify Hostinger SMTP credentials (smtp.hostinger.com:465 SSL).\n\nIf you are reading this, Hostinger SMTP sending is functional and ready for throttled live dispatch.",
    });

    return NextResponse.json({
      success: true,
      message: `Test email successfully dispatched to ${recipient}`,
      messageId: testResult.messageId,
    });
  } catch (err: any) {
    console.error("Send test email error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Failed to send test email via Hostinger SMTP",
        details: "Ensure SMTP_HOST, SMTP_PORT (465), SMTP_USER, and SMTP_PASS are set in .env.local",
      },
      { status: 500 }
    );
  }
}
