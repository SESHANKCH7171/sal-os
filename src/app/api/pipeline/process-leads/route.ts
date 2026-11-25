import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAgentBrain } from "@/lib/ai/agent-brain";
import { evaluateIcpQualification, evaluateOfferRouting, evaluateAiEmployeeRole } from "@/lib/ai/jev-client";
import { runWaterfallEnrichment } from "@/lib/enrichment/waterfall";
import { generateOutreachAssets } from "@/lib/ai/gemini-text";
import { assertBudgetAvailable } from "@/lib/guardrails/budget-breaker";

export const dynamic = "force-dynamic";

// Helper delay to strictly prevent rate limiting
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(req: NextRequest) {
  try {
    // 1. Auth check: user or CRON_SECRET
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isCron) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const allowedEmail = (
        process.env.ALLOWED_USER_EMAIL || "seshank@seshankailabs.com"
      ).toLowerCase().trim();

      if (!user || user.email?.toLowerCase().trim() !== allowedEmail) {
        return NextResponse.json(
          { error: "Unauthorized access. Single-user locked." },
          { status: 401 }
        );
      }
    }

    const adminClient = createAdminClient();

    // 2. Fetch up to 5 leads: prefer queued_for_today, then vaulted, where email_status is 'pending'
    const { data: leadsToProcess, error: fetchErr } = await adminClient
      .from("leads")
      .select("*")
      .in("vault_stage", ["queued_for_today", "vaulted"])
      .eq("email_status", "pending")
      .lt("processing_attempts", 3)
      .order("created_at", { ascending: true })
      .limit(5);

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    if (!leadsToProcess || leadsToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No pending leads found to process in queue.",
        processedCount: 0,
        leads: [],
      });
    }

    // 3. Pre-load Brand Vault offers for reference
    const { data: brandVaultRows } = await adminClient.from("brand_vault").select("*");
    const brandVaultMap = new Map((brandVaultRows || []).map((b) => [b.offer_key, b]));

    const processedLeads: any[] = [];
    const errors: any[] = [];

    // 4. Sequential Processing Loop (max 5 leads per request with 4s delay between leads)
    for (let i = 0; i < leadsToProcess.length; i++) {
      const lead = leadsToProcess[i];
      const leadId = lead.id;

      try {
        // Assert budget availability before starting lead pipeline
        await assertBudgetAvailable("mesh_jev");
        await assertBudgetAvailable("gemini_text");

        // Increment processing attempts
        await adminClient
          .from("leads")
          .update({ processing_attempts: (lead.processing_attempts || 0) + 1 })
          .eq("id", leadId);

        // A. Load Agent Brain (Schedule, Quotas, Company Collision Lock)
        const region = (lead.location_region || "OTHER") as any;
        const brain = await loadAgentBrain("head_outreach_agent", region, lead.company_id);

        if (brain.companyLock.isLocked) {
          await adminClient
            .from("leads")
            .update({
              vault_stage: "archived",
              email_status: "paused",
              last_error: brain.companyLock.lockReason,
            })
            .eq("id", leadId);

          processedLeads.push({ id: leadId, name: lead.full_name, status: "company_locked", reason: brain.companyLock.lockReason });
          continue;
        }

        // B. Gate 1: ICP Qualification (Noul)
        const icpEval = await evaluateIcpQualification({
          fullName: lead.full_name,
          title: lead.title,
          company: lead.company,
          industry: lead.industry,
          region: lead.location_region,
        });

        if (!icpEval.result) {
          // Non-decision maker or out-of-scope -> drop before spending paid enrichment
          await adminClient
            .from("leads")
            .update({
              jev_icp_qualified: false,
              jev_confidence_score: icpEval.confidence,
              email_status: "rejected",
              vault_stage: "archived",
              enrichment_summary: `Disqualified at Jev Gate 1: ${icpEval.reasoning}`,
            })
            .eq("id", leadId);

          await adminClient.from("outreach_ledger").insert({
            company_id: lead.company_id,
            lead_id: leadId,
            agent_name: "head_outreach_agent",
            channel: "system",
            event_type: "rejected",
            region: lead.location_region,
            city: lead.city,
            summary: `ICP Disqualified: ${icpEval.reasoning}`,
          });

          processedLeads.push({ id: leadId, name: lead.full_name, status: "icp_disqualified", reason: icpEval.reasoning });
          continue;
        }

        // C. Gate 2: Offer Routing (Choice)
        const offerEval = await evaluateOfferRouting({
          fullName: lead.full_name,
          title: lead.title,
          company: lead.company,
          industry: lead.industry,
          region: lead.location_region,
        });
        const targetOfferKey = offerEval.result;

        // D. Gate 3: AI Employee Role Diagnosis (Choice)
        let aiRole = "none";
        if (targetOfferKey === "custom_ai_employee") {
          const roleEval = await evaluateAiEmployeeRole({
            fullName: lead.full_name,
            title: lead.title,
            company: lead.company,
            industry: lead.industry,
          });
          aiRole = roleEval.result;
        }

        // E. Waterfall Enrichment (Apollo -> MX check -> Tavily/Serper research)
        const enrichment = await runWaterfallEnrichment({
          fullName: lead.full_name,
          companyName: lead.company,
          linkedinUrl: lead.normalized_linkedin_url || lead.linkedin_url,
          email: lead.email,
          emailVerificationStatus: lead.email_verification_status,
        });

        // Deterministic Channel Route & Email Gate Calculation
        const hasValidEmail = Boolean(enrichment.email && enrichment.emailVerificationStatus !== "undeliverable");
        const hasLinkedIn = Boolean(lead.normalized_linkedin_url);

        let channelRoute: "dual_channel" | "linkedin_only" | "email_only" = "dual_channel";
        if (hasValidEmail && hasLinkedIn) {
          channelRoute = "dual_channel";
        } else if (hasLinkedIn && !hasValidEmail) {
          channelRoute = "linkedin_only";
        } else if (hasValidEmail && !hasLinkedIn) {
          channelRoute = "email_only";
        }

        // If !hasValidEmail, set email_status = 'paused' (NEVER 'awaiting_green_light')
        const finalEmailStatus = hasValidEmail ? "awaiting_green_light" : "paused";

        // F. Load Offer Data from Brand Vault
        const defaultOfferInfo = {
          saas_lead_gen: {
            displayName: "B2B Lead Gen for B2B SaaS Companies",
            coreHook: "Permission-first 10-lead free sniper sheet before any commercial pitch",
            proofPoints: "Approached 100–150 companies, 3–5 engaged replies, signed Vineet Pinto, CEO of Analytics Depot",
            pricingNotes: "14-day paid pilot ($850–$900) or $200/meeting booked",
            writingRules: "Zero em dashes. Under 65 words for Step 1 cold emails.",
          },
          custom_ai_employee: {
            displayName: "Custom AI Employees",
            coreHook: "Deploy turnkey AI Employees directly to eliminate operational bottlenecks and recover missed revenue",
            proofPoints: "Zero headcount overhead, 24/7 instant response, turnkey integration into existing WhatsApp/Email workflows",
            pricingNotes: "Setup fee ($1,500–$3,500) + monthly maintenance retainer ($500–$1,500/mo)",
            writingRules: "Zero em dashes. Direct, pain-focused, pragmatic.",
          },
          founder_website: {
            displayName: "High-Profile Founder Websites",
            coreHook: "Bespoke 1-page personal executive websites that build instant authority for referrals, partners, and investors",
            proofPoints: "Executive personal branding converts institutional capital and top partners far better than corporate landing pages",
            pricingNotes: "$750–$850 USD (US/UK) | 3,500 SAR / AED (KSA/UAE)",
            writingRules: "Zero em dashes. Prestigious, respectful, peer-to-peer tone.",
          },
        };

        const vaultData = brandVaultMap.get(targetOfferKey) || defaultOfferInfo[targetOfferKey];

        // G. Gemini 2.5 Flash Generation with Zod, Prompt Injection Protection & Text Validator
        let outreachResult;
        let retryCount = 0;
        const maxRetries = 2;

        while (retryCount <= maxRetries) {
          try {
            outreachResult = await generateOutreachAssets({
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
                offerKey: targetOfferKey,
                displayName: vaultData.display_name || defaultOfferInfo[targetOfferKey].displayName,
                coreHook: vaultData.core_hook || defaultOfferInfo[targetOfferKey].coreHook,
                proofPoints: vaultData.proof_points || defaultOfferInfo[targetOfferKey].proofPoints,
                pricingNotes: vaultData.pricing_notes || defaultOfferInfo[targetOfferKey].pricingNotes,
                writingRules: vaultData.writing_rules || defaultOfferInfo[targetOfferKey].writingRules,
              },
              aiEmployeeRole: aiRole,
              evidenceSources: enrichment.evidenceSources,
            });
            break;
          } catch (genErr: any) {
            retryCount++;
            if (genErr?.message?.includes("429") || genErr?.message?.includes("RESOURCE_EXHAUSTED")) {
              console.warn(`429 rate limit hit. Exponential backoff attempt ${retryCount}...`);
              await delay(Math.pow(2, retryCount) * 2000); // 2s, 4s backoff
            } else if (retryCount > maxRetries) {
              throw genErr;
            }
          }
        }

        if (!outreachResult) {
          throw new Error("Failed to generate outreach assets after retries.");
        }

        // H. Persist to Database: STOP STRICTLY AT awaiting_green_light
        const { assets, qaScore, needsHumanReview } = outreachResult;

        await adminClient
          .from("leads")
          .update({
            jev_icp_qualified: true,
            target_offer: targetOfferKey,
            ai_employee_role: aiRole,
            channel_route: channelRoute,
            jev_confidence_score: offerEval.confidence,
            needs_human_review: needsHumanReview,
            enrichment_summary: enrichment.enrichmentSummary,
            evidence_sources: enrichment.evidenceSources,
            agent_reasoning: assets.agent_reasoning,
            email: enrichment.email,
            email_verification_status: enrichment.emailVerificationStatus,
            email_subject: assets.email_subject,
            email_step1: assets.email_step1,
            email_step2_followup: assets.email_step2_followup,
            email_step3_followup: assets.email_step3_followup,
            linkedin_dm_delivery: assets.linkedin_dm_delivery,
            // STRICT HUMAN-IN-THE-LOOP RULE:
            email_status: finalEmailStatus,
            linkedin_status: "pending", // blank initial connect
            vault_stage: "active",
            last_error: null,
          })
          .eq("id", leadId);

        // I. Immutable Outreach Ledger Record
        await adminClient.from("outreach_ledger").insert({
          company_id: lead.company_id,
          lead_id: leadId,
          agent_name: "head_outreach_agent",
          channel: channelRoute === "linkedin_only" ? "linkedin_blank_connect" : "email",
          event_type: "drafted",
          region: lead.location_region,
          city: lead.city,
          summary: `Drafted outreach for ${lead.full_name} (${targetOfferKey}). QA Score: ${qaScore.toFixed(2)}. Status: ${finalEmailStatus}.`,
          metadata: {
            chosen_offer: targetOfferKey,
            ai_employee_role: aiRole,
            qa_score: qaScore,
            needs_human_review: needsHumanReview,
            email_status: finalEmailStatus,
          },
        });

        processedLeads.push({
          id: leadId,
          name: lead.full_name,
          offer: targetOfferKey,
          role: aiRole,
          qaScore,
          emailStatus: finalEmailStatus,
          needsHumanReview,
        });
      } catch (leadError: any) {
        console.error(`Error processing lead ${lead.full_name} (${leadId}):`, leadError);
        errors.push({ leadId, name: lead.full_name, error: leadError.message });

        await adminClient
          .from("leads")
          .update({
            last_error: leadError.message,
            needs_human_review: (lead.processing_attempts || 0) + 1 >= 3,
          })
          .eq("id", leadId);
      }

      // 4-SECOND DELAY between sequential leads to stay safely below free RPM limits
      if (i < leadsToProcess.length - 1) {
        await delay(4000);
      }
    }

    return NextResponse.json({
      success: true,
      processedCount: processedLeads.length,
      processedLeads,
      errors,
    });
  } catch (globalErr: any) {
    console.error("Pipeline process leads error:", globalErr);
    return NextResponse.json(
      { error: globalErr.message || "Pipeline processing encountered an unhandled error" },
      { status: 500 }
    );
  }
}
