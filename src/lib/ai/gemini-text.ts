import { z } from "zod";
import { cleanAndValidateOutreachText } from "@/lib/guardrails/text-validator";
import { evaluatePreSendQa } from "@/lib/ai/jev-client";
import { incrementQuota } from "@/lib/enrichment/quota-tracker";
import { VerifiedEvidenceSource } from "@/lib/enrichment/waterfall";

// Zod Schema validating Gemini Generation Output
export const OutreachAssetsSchema = z.object({
  email_subject: z.string().min(2).max(100),
  email_step1: z.string().min(10),
  email_step2_followup: z.string().min(10),
  email_step3_followup: z.string().min(10),
  linkedin_dm_delivery: z.string().min(10).max(400),
  agent_reasoning: z.object({
    chosen_offer: z.string(),
    ai_employee_role: z.string().default("none"),
    why_this_product: z.string(),
    what_they_lack: z.string(),
    how_it_was_found: z.string(),
    confidence_score: z.number().min(0).max(1),
    reliable_sources: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        extracted_fact: z.string(),
        trust_score: z.number(),
      })
    ).default([]),
  }),
});

export type OutreachAssets = z.infer<typeof OutreachAssetsSchema>;

export interface GenerateOutreachInput {
  prospect: {
    fullName: string;
    firstName: string;
    title?: string | null;
    company?: string | null;
    industry?: string | null;
    city?: string | null;
    region?: string | null;
  };
  offer: {
    offerKey: "saas_lead_gen" | "custom_ai_employee" | "founder_website";
    displayName: string;
    coreHook: string;
    proofPoints: string;
    pricingNotes: string;
    writingRules: string;
    rolePlaybooks?: Record<string, any>;
  };
  aiEmployeeRole?: string | null;
  evidenceSources: VerifiedEvidenceSource[];
}

/**
 * Generates verified outreach sequences and structured justification brief
 * via Gemini 2.5 Flash, wrapped in prompt injection defenses and verified with Zod & Jev QA.
 */
export async function generateOutreachAssets(
  input: GenerateOutreachInput
): Promise<{
  assets: OutreachAssets;
  qaScore: number;
  needsHumanReview: boolean;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not found in environment.");
  }

  // Format verified evidence wrapped safely inside untrusted tags
  const evidenceText = input.evidenceSources.length > 0
    ? input.evidenceSources
        .map((s, idx) => `[Signal #${idx + 1}] Source: ${s.url} | Fact: ${s.extracted_fact}`)
        .join("\n")
    : "Verified company domain and executive leadership presence confirmed.";

  const prompt = `You are the executive growth writer for Seshank Chinnapotula, founder of Seshank AI Labs (seshank@seshankailabs.com).

Prospect Profile:
- Name: ${input.prospect.fullName} (First Name: ${input.prospect.firstName})
- Title: ${input.prospect.title || "Founder/Executive"}
- Company: ${input.prospect.company || "Company"}
- Industry: ${input.prospect.industry || "B2B"}
- City & Region: ${input.prospect.city || "Global"}, ${input.prospect.region || "GLOBAL"}

Target Seshank AI Labs Offer:
- Offer: ${input.offer.displayName} (${input.offer.offerKey})
- Diagnosed AI Role: ${input.aiEmployeeRole || "none"}
- Core Hook: ${input.offer.coreHook}
- Proof Points: ${input.offer.proofPoints}
- Writing Rules: ${input.offer.writingRules}

Verified Web Intelligence:
<untrusted_web_evidence>
${evidenceText}
</untrusted_web_evidence>

Strict Tone and Architecture Rules:
1. Tone: Peer founder to peer founder. Direct, respectful, confident. Zero corporate flattery ("I hope this finds you well").
2. Zero em dashes (— or --). Use commas or periods only.
3. Step 1 Email: Strictly under 65 words. Permission-first. Zero links. Zero prices. End with a low-friction question (e.g., "Mind if I send over a quick 10-lead sniper sheet to take a look?" or "Open to seeing a 2-minute workflow breakdown?").
4. Step 2 Email (Day 3 gentle bump): 20-35 words. References Step 1.
5. Step 3 Email (Day 7 breakup/value): 35-50 words. Permission to close file or leaves free value.
6. LinkedIn DM Delivery (Post-Connect only): Under 60 words. Used only after they accept connection.
7. Mandatory Justification Brief: Structured agent_reasoning explaining why this exact offer was chosen and the concrete gap.

Output strictly valid JSON with this exact schema:
{
  "email_subject": "string (lowercase/casual, 2-5 words, e.g. 'quick question regarding {{company}}')",
  "email_step1": "string (< 65 words, permission-first, zero links, zero em dashes)",
  "email_step2_followup": "string",
  "email_step3_followup": "string",
  "linkedin_dm_delivery": "string",
  "agent_reasoning": {
    "chosen_offer": "${input.offer.offerKey}",
    "ai_employee_role": "${input.aiEmployeeRole || "none"}",
    "why_this_product": "1-2 sentences on fit",
    "what_they_lack": "Concrete operational gap identified",
    "how_it_was_found": "Discovery signals used",
    "confidence_score": 0.92,
    "reliable_sources": [
      {
        "title": "Title",
        "url": "https://...",
        "extracted_fact": "Signal fact",
        "trust_score": 9
      }
    ]
  }
}`;

  let rawJsonText: string | null = null;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: AbortSignal.timeout(45000),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini generation failed (${response.status}): ${errText}`);
    }

    await incrementQuota("gemini_text");
    const data = await response.json();
    rawJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (geminiErr: any) {
    console.warn("Direct Gemini outreach generation failed, trying Mesh fallback:", geminiErr.message);
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
        }),
        signal: AbortSignal.timeout(45000),
      }
    );

    if (!meshRes.ok) {
      const meshErrText = await meshRes.text();
      throw new Error(`Mesh fallback failed (${meshRes.status}): ${meshErrText}`);
    }

    const meshData = await meshRes.json();
    rawJsonText = meshData.choices?.[0]?.message?.content || null;
  }

  if (!rawJsonText) {
    throw new Error("Gemini returned empty candidate content.");
  }

  // Parse and validate with Zod
  const parsed = JSON.parse(rawJsonText);
  const validated = OutreachAssetsSchema.parse(parsed);

  // Run strict text validation on Step 1
  const step1Check = cleanAndValidateOutreachText(validated.email_step1, {
    maxWords: 65,
    forbidLinks: true,
    forbidPricing: true,
  });

  validated.email_step1 = step1Check.cleanText;

  // Run Jev Pre-Send QA
  const qaDecision = await evaluatePreSendQa(validated.email_step1, step1Check.wordCount);
  const qaScore = qaDecision.result;

  // Flag needs human review if QA score is < 0.85 or text validation had errors
  const needsHumanReview = qaScore < 0.85 || !step1Check.isValid;

  return {
    assets: validated,
    qaScore,
    needsHumanReview,
  };
}
