import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateOutreachAssets } from "@/lib/ai/gemini-text";
import { evaluateAiEmployeeRole } from "@/lib/ai/jev-client";

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

    const { leadId, newOfferKey } = await req.json();
    if (!leadId || !newOfferKey) {
      return NextResponse.json({ error: "Missing leadId or newOfferKey" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 1. Fetch Lead
    const { data: lead, error: fetchErr } = await adminClient
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (fetchErr || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // 2. Fetch Brand Vault data for the chosen offer
    const { data: vaultRow } = await adminClient
      .from("brand_vault")
      .select("*")
      .eq("offer_key", newOfferKey)
      .maybeSingle();

    let aiRole = "none";
    if (newOfferKey === "custom_ai_employee") {
      const roleEval = await evaluateAiEmployeeRole({
        fullName: lead.full_name,
        company: lead.company,
        industry: lead.industry,
        title: lead.title,
      });
      aiRole = roleEval.result;
    }

    // 3. Re-draft with Gemini Flash
    const { assets, qaScore, needsHumanReview } = await generateOutreachAssets({
      prospect: {
        fullName: lead.full_name,
        firstName: lead.first_name,
        title: lead.title,
        company: lead.company,
        industry: lead.industry,
        city: lead.city,
        region: lead.location_region,
      },
      offer: {
        offerKey: newOfferKey,
        displayName: vaultRow?.display_name || newOfferKey,
        coreHook: vaultRow?.core_hook || "Targeted value hook",
        proofPoints: vaultRow?.proof_points || "Proven track record",
        pricingNotes: vaultRow?.pricing_notes || "Performance model",
        writingRules: vaultRow?.writing_rules || "Zero em dashes. Under 65 words.",
      },
      aiEmployeeRole: aiRole,
      evidenceSources: lead.evidence_sources || [],
    });

    // 4. Update lead
    const { data: updatedLead, error: updateErr } = await adminClient
      .from("leads")
      .update({
        target_offer: newOfferKey,
        ai_employee_role: aiRole,
        email_subject: assets.email_subject,
        email_step1: assets.email_step1,
        email_step2_followup: assets.email_step2_followup,
        email_step3_followup: assets.email_step3_followup,
        linkedin_dm_delivery: assets.linkedin_dm_delivery,
        agent_reasoning: assets.agent_reasoning,
        needs_human_review: needsHumanReview,
        email_status: "awaiting_green_light",
      })
      .eq("id", leadId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return NextResponse.json({
      success: true,
      lead: updatedLead,
      qaScore,
    });
  } catch (err: any) {
    console.error("Regenerate draft error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to regenerate draft" },
      { status: 500 }
    );
  }
}
