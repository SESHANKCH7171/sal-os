import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { incrementQuota } from "@/lib/enrichment/quota-tracker";

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

    const { leadId, channel, prospectMessage } = await req.json();
    if (!leadId || !prospectMessage) {
      return NextResponse.json(
        { error: "Missing leadId or prospectMessage" },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();
    const { data: lead, error: leadErr } = await adminClient
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (leadErr || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Fetch Brand Vault context for the lead's target_offer
    const offerKey = lead.target_offer || "custom_ai_employee";
    const { data: vaultOffer } = await adminClient
      .from("brand_vault")
      .select("*")
      .eq("offer_key", offerKey)
      .maybeSingle();

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";

    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
        { status: 500 }
      );
    }

    await incrementQuota("gemini_text");

    const prompt = `You are Seshank Chinnapotula, founder of Seshank AI Labs. Draft a concise peer-to-peer reply to a prospect's message.

Prospect: ${lead.full_name} (${lead.title || "Executive"} at ${lead.company || "Company"})
Channel: ${channel === "linkedin" ? "LinkedIn DM" : "Email"}
Target Offer: ${vaultOffer?.display_name || offerKey}
Core Hook: ${vaultOffer?.core_hook || "Permission-first value delivery"}
Proof Points: ${vaultOffer?.proof_points || "Proven outbound & AI employee deployments"}
Pricing Notes (share ONLY if prospect explicitly asked about pricing): ${vaultOffer?.pricing_notes || "Discuss after quick value demo"}

Prospect's Message:
"${prospectMessage}"

STRICT RULES:
1. Peer founder tone. Concise, warm, helpful, zero corporate fluff.
2. ZERO em dashes (never use — or --). Use commas or periods only.
3. Under 75 words for email, under 45 words for LinkedIn DM.
4. Answer their exact question or move forward naturally with low friction.
5. Output ONLY the reply body text, no subject line, no quotes.`;

    let draftReply = "";

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 512,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          signal: AbortSignal.timeout(45000),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      draftReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (geminiErr: any) {
      console.warn("Direct Gemini reply draft failed, trying Mesh fallback:", geminiErr.message);
      const meshKey = process.env.MESH_API_KEY;
      if (!meshKey) throw geminiErr;

      await incrementQuota("mesh_jev");
      const meshRes = await fetch(
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
              { role: "system", content: "Write concise peer-founder replies. Output plain text only." },
              { role: "user", content: prompt },
            ],
            max_tokens: 512,
            temperature: 0.4,
          }),
          signal: AbortSignal.timeout(45000),
        }
      );

      if (!meshRes.ok) {
        const meshErrText = await meshRes.text();
        throw new Error(`Mesh fallback error (${meshRes.status}): ${meshErrText}`);
      }

      const meshData = await meshRes.json();
      draftReply = meshData.choices?.[0]?.message?.content || "";
    }
    draftReply = draftReply
      .replace(/^["']|["']$/g, "")
      .replace(/[\u2014\u2013]/g, ", ")
      .replace(/\s*--\s*/g, ", ")
      .trim();

    return NextResponse.json({
      success: true,
      draftReply,
      suggestedSubject: lead.email_subject
        ? lead.email_subject.startsWith("Re: ")
          ? lead.email_subject
          : `Re: ${lead.email_subject}`
        : `Re: ${lead.company || "Quick follow-up"}`,
    });
  } catch (err: any) {
    console.error("Draft reply error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to draft reply" },
      { status: 500 }
    );
  }
}
