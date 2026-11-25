import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { incrementQuota } from "@/lib/enrichment/quota-tracker";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ContentGenSchema = z.object({
  hook_options: z.array(z.string()).min(1).max(5),
  post_body: z.string().min(20),
  image_prompt: z.string().min(10),
});

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

    const {
      accountType = "personal_seshank",
      offerKey = "saas_lead_gen",
      topic = "",
      visualStyle = "architecture_diagram",
    } = await req.json();

    const adminClient = createAdminClient();
    const { data: vaultOffer } = await adminClient
      .from("brand_vault")
      .select("*")
      .eq("offer_key", offerKey)
      .maybeSingle();

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";

    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    await incrementQuota("gemini_text");

    const accountGuidance =
      accountType === "company_seshank_ai_labs"
        ? "Account: Seshank AI Labs (Company Page). Focus on crisp case studies, operational architectures, measurable ROI, and client deployment teardowns."
        : "Account: Seshank Chinnapotula (Personal Profile). Focus on authentic builder stories, real outbound/AI engineering proof, and founder-to-founder lessons.";

    const prompt = `You are writing a high-signal LinkedIn post for Seshank AI Labs.

${accountGuidance}
Target Offer Grounding (${offerKey}):
- Display Name: ${vaultOffer?.display_name || offerKey}
- Target ICP: ${vaultOffer?.target_icp || "B2B Founders & Operators"}
- Core Hook: ${vaultOffer?.core_hook || "Permission-first outbound & custom AI employees"}
- Proof Points: ${vaultOffer?.proof_points || "Signed Vineet Pinto, CEO of Analytics Depot; 24/7 AI ops workflows"}
- Topic / Angle: ${topic || "Share a real lesson or teardown from building and deploying this exact offer."}

STRICT RULES:
1. ZERO em dashes (never use — or --). Use commas or periods only.
2. Peer-founder tone. Short punchy lines, high readability on mobile, zero corporate hype or emojis overload.
3. No fake metrics. Only reference verified proof points from Brand Vault or general operational mechanics.
4. Provide 3 alternative opening hooks in hook_options.
5. Provide a detailed dark-mode executive graphic prompt in image_prompt matching style "${visualStyle}" (sleek dark slate #0A0D15 background, indigo/emerald accents, clean typography/architecture visual).

Output strict JSON:
{
  "hook_options": ["hook 1", "hook 2", "hook 3"],
  "post_body": "full linkedin post text with line breaks",
  "image_prompt": "detailed visual prompt for Nano Banana 2.1"
}`;

    let rawJson: string | null = null;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.6,
              maxOutputTokens: 2048,
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
      rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (geminiErr: any) {
      console.warn("Direct Gemini content generation failed, trying Mesh fallback:", geminiErr.message);
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
              { role: "system", content: "Output strict JSON only." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
            max_tokens: 2048,
          }),
          signal: AbortSignal.timeout(45000),
        }
      );

      if (!meshRes.ok) {
        const meshErrText = await meshRes.text();
        throw new Error(`Mesh fallback error (${meshRes.status}): ${meshErrText}`);
      }

      const meshData = await meshRes.json();
      rawJson = meshData.choices?.[0]?.message?.content || null;
    }

    if (!rawJson) throw new Error("Empty response from Gemini/Mesh");

    const parsed = ContentGenSchema.parse(JSON.parse(rawJson));
    const cleanBody = parsed.post_body
      .replace(/[\u2014\u2013]/g, ", ")
      .replace(/\s*--\s*/g, ", ")
      .trim();
    const cleanHooks = parsed.hook_options.map((h) =>
      h.replace(/[\u2014\u2013]/g, ", ").replace(/\s*--\s*/g, ", ").trim()
    );

    // Map offerKey to schema.sql pillar check constraint:
    // check (pillar in ('saas_lead_gen', 'custom_ai_employees', 'agentic_ai_progress', 'founder_website'))
    const pillar =
      offerKey === "custom_ai_employee"
        ? "custom_ai_employees"
        : offerKey === "founder_website"
        ? "founder_website"
        : "saas_lead_gen";

    const { data: savedPost, error: insertErr } = await adminClient
      .from("content_posts")
      .insert({
        account_type:
          accountType === "company_seshank_ai_labs"
            ? "company_seshank_ai_labs"
            : "personal_seshank",
        pillar,
        input_source: "text",
        raw_idea: topic || offerKey,
        hook_options: cleanHooks,
        post_body: cleanBody,
        visual_style: visualStyle,
        image_prompt: parsed.image_prompt,
        status: "draft",
      })
      .select("*")
      .single();

    if (insertErr) {
      console.error("Failed to save content_post:", insertErr);
    }

    return NextResponse.json({
      success: true,
      post: savedPost || null,
      hook_options: cleanHooks,
      post_body: cleanBody,
      image_prompt: parsed.image_prompt,
    });
  } catch (err: any) {
    console.error("Content generate error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate content" },
      { status: 500 }
    );
  }
}
