import { incrementQuota } from "@/lib/enrichment/quota-tracker";
import { z } from "zod";

export interface JevDecisionResponse<T = any> {
  result: T;
  reasoning: string;
  confidence: number;
  provider: "mesh_jev_evaluate" | "mesh_chat_fallback" | "gemini_direct_fallback" | "local_heuristic";
}

export interface LeadProfileInput {
  fullName: string;
  title?: string | null;
  company?: string | null;
  industry?: string | null;
  city?: string | null;
  region?: string | null;
  enrichmentSummary?: string | null;
}

export const JevLeadClassificationSchema = z.object({
  jev_icp_qualified: z.boolean(),
  target_offer: z.enum(["saas_lead_gen", "custom_ai_employee", "founder_website"]),
  ai_employee_role: z.enum([
    "ai_sdr",
    "ai_receptionist",
    "ai_ops_copilot",
    "ai_support_agent",
    "custom_workflow_agent",
    "none",
  ]),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});

export type JevLeadClassification = z.infer<typeof JevLeadClassificationSchema>;

/**
 * 1. Low-level caller to Mesh API Jev model via /v1/evaluate
 */
async function callMeshJevEvaluate(
  prompt: string,
  primitive: "Bool" | "Choice" | "Score",
  options?: string[]
): Promise<any> {
  const apiKey = process.env.MESH_API_KEY;
  const baseUrl = process.env.MESH_API_BASE_URL || "https://api.meshapi.ai/v1";
  const modelId = process.env.JEV_MODEL_ID || "typesafe/jev-1.13";

  if (!apiKey) {
    throw new Error("MESH_API_KEY not configured in environment");
  }

  // Always log every Mesh API attempt to api_usage_logs under 'mesh_jev'
  await incrementQuota("mesh_jev");

  const response = await fetch(`${baseUrl}/evaluate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      primitive,
      prompt,
      options: options || undefined,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Mesh API /v1/evaluate error (${response.status}):`, errorText);
    throw new Error(`Mesh API /v1/evaluate failed (${response.status}): ${errorText}`);
  }

  return await response.json();
}

/**
 * 2. Fallback Level 1: Mesh API /v1/chat/completions with google/gemini-2.5-flash-lite
 */
async function callMeshChatFallback(lead: LeadProfileInput): Promise<JevLeadClassification> {
  const apiKey = process.env.MESH_API_KEY;
  const baseUrl = process.env.MESH_API_BASE_URL || "https://api.meshapi.ai/v1";

  if (!apiKey) {
    throw new Error("MESH_API_KEY not configured for chat fallback");
  }

  // Log Mesh call
  await incrementQuota("mesh_jev");

  const prompt = `Classify this business lead for Seshank AI Labs:
Name: ${lead.fullName}
Title: ${lead.title || "Unknown"}
Company: ${lead.company || "Unknown"}
Industry: ${lead.industry || "Unknown"}
City/Region: ${lead.city || ""}, ${lead.region || ""}

Classification Rules:
1. 'jev_icp_qualified': true if the prospect is a Founder, Co-Founder, CEO, Managing Director, Partner, Principal, COO, VP Sales/Growth, or Head of BD. False for interns, students, junior roles, or irrelevant non-decision makers.
2. 'target_offer':
   - 'saas_lead_gen': ONLY for B2B SaaS, software platforms, and tech outbound.
   - 'custom_ai_employee': For non-tech businesses (Dental/Medical clinics -> 'ai_receptionist', Salons/Hospitality -> 'ai_receptionist', B2B Agencies/Consulting -> 'ai_sdr', Construction/Real Estate/Logistics operations -> 'ai_ops_copilot', E-commerce -> 'ai_support_agent', other bottlenecks -> 'custom_workflow_agent').
   - 'founder_website': For High-Profile Founders, Managing Directors, Principals, and Partners in traditional non-tech industries (Real Estate, Construction, Healthcare, Private Equity) needing personal authority sites.
3. 'ai_employee_role': 'ai_sdr' | 'ai_receptionist' | 'ai_ops_copilot' | 'ai_support_agent' | 'custom_workflow_agent' | 'none' (set to 'none' if target_offer is saas_lead_gen or founder_website).

Output JSON strictly matching this schema:
{
  "jev_icp_qualified": boolean,
  "target_offer": "saas_lead_gen" | "custom_ai_employee" | "founder_website",
  "ai_employee_role": "ai_sdr" | "ai_receptionist" | "ai_ops_copilot" | "ai_support_agent" | "custom_workflow_agent" | "none",
  "reasoning": "string",
  "confidence": number between 0.0 and 1.0
}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content: "You are the Jev decision engine for Seshank AI Labs. Output strict JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Mesh API /v1/chat/completions error (${response.status}):`, errorText);
    throw new Error(`Mesh API chat fallback failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) throw new Error("Empty response from Mesh chat fallback");

  const parsed = JSON.parse(rawText);
  return JevLeadClassificationSchema.parse(parsed);
}

/**
 * 3. Fallback Level 2: Direct Google Gemini 2.5 Flash
 */
async function callDirectGeminiFallback(lead: LeadProfileInput): Promise<JevLeadClassification> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";

  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY not configured for direct fallback");
  }

  await incrementQuota("gemini_text");

  const prompt = `Classify this lead for Seshank AI Labs:
Name: ${lead.fullName}
Title: ${lead.title || "Unknown"}
Company: ${lead.company || "Unknown"}
Industry: ${lead.industry || "Unknown"}
City/Region: ${lead.city || ""}, ${lead.region || ""}

Rules:
1. 'jev_icp_qualified': true for founders, CEOs, MDs, partners, COOs, VPs. False for students, interns, junior individual contributors.
2. 'target_offer':
   - 'saas_lead_gen': ONLY B2B SaaS/software.
   - 'custom_ai_employee': Clinics/Practices -> 'ai_receptionist', Agencies -> 'ai_sdr', Construction/Real Estate/Logistics -> 'ai_ops_copilot', E-commerce -> 'ai_support_agent'.
   - 'founder_website': High-profile MDs/Founders in Real Estate, Construction, Healthcare needing personal authority sites.
3. 'ai_employee_role': 'ai_sdr' | 'ai_receptionist' | 'ai_ops_copilot' | 'ai_support_agent' | 'custom_workflow_agent' | 'none'.

Output valid JSON strictly matching the schema.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Direct Gemini fallback error (${response.status}):`, errorText);
    throw new Error(`Direct Gemini fallback failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error("Empty response from Direct Gemini fallback");

  const parsed = JSON.parse(rawText);
  return JevLeadClassificationSchema.parse(parsed);
}

/**
 * 4. Fallback Level 3: Deterministic Rule Heuristic (Never defaults blindly to saas_lead_gen)
 */
function evaluateDeterministicHeuristic(lead: LeadProfileInput): JevLeadClassification {
  const titleLower = (lead.title || "").toLowerCase();
  const indLower = (lead.industry || "").toLowerCase();
  const compLower = (lead.company || "").toLowerCase();

  // ICP Check
  const decisionMakerKeywords = [
    "founder",
    "ceo",
    "co-founder",
    "managing director",
    "partner",
    "principal",
    "coo",
    "president",
    "chief",
    "head of growth",
    "head of bd",
    "vp",
    "owner",
    "director",
  ];
  const disqualifiedKeywords = ["intern", "student", "assistant", "specialist", "coordinator", "entry level", "junior"];

  const isDisqualified = disqualifiedKeywords.some((w) => titleLower.includes(w));
  const isQualified = decisionMakerKeywords.some((w) => titleLower.includes(w)) && !isDisqualified;

  // Strict Offer Routing
  let targetOffer: "saas_lead_gen" | "custom_ai_employee" | "founder_website" = "custom_ai_employee";
  let aiRole: "ai_sdr" | "ai_receptionist" | "ai_ops_copilot" | "ai_support_agent" | "custom_workflow_agent" | "none" = "custom_workflow_agent";

  const isSaas =
    indLower.includes("saas") ||
    indLower.includes("software") ||
    compLower.includes("software") ||
    compLower.includes("cloud platform");

  const isTraditionalAuthority =
    (indLower.includes("real estate") ||
      indLower.includes("construction") ||
      indLower.includes("property") ||
      indLower.includes("healthcare") ||
      indLower.includes("capital") ||
      indLower.includes("wealth") ||
      indLower.includes("investment")) &&
    (titleLower.includes("founder") ||
      titleLower.includes("managing director") ||
      titleLower.includes("managing partner") ||
      titleLower.includes("principal"));

  if (isSaas) {
    targetOffer = "saas_lead_gen";
    aiRole = "none";
  } else if (isTraditionalAuthority) {
    targetOffer = "founder_website";
    aiRole = "none";
  } else {
    targetOffer = "custom_ai_employee";
    if (indLower.includes("dental") || indLower.includes("clinic") || indLower.includes("salon") || indLower.includes("hospitality")) {
      aiRole = "ai_receptionist";
    } else if (indLower.includes("agency") || indLower.includes("consulting") || indLower.includes("marketing")) {
      aiRole = "ai_sdr";
    } else if (indLower.includes("construction") || indLower.includes("real estate") || indLower.includes("logistics") || indLower.includes("legal")) {
      aiRole = "ai_ops_copilot";
    } else if (indLower.includes("ecommerce") || indLower.includes("retail") || indLower.includes("store")) {
      aiRole = "ai_support_agent";
    } else {
      aiRole = "custom_workflow_agent";
    }
  }

  return {
    jev_icp_qualified: isQualified,
    target_offer: targetOffer,
    ai_employee_role: aiRole,
    reasoning: `Deterministic heuristic applied. Offer: ${targetOffer}, Role: ${aiRole}.`,
    confidence: 0.85,
  };
}

/**
 * Master Unified Classifier with full fallback chain:
 * 1. Mesh API /v1/evaluate (Bool / Choice)
 * 2. Mesh API /v1/chat/completions (google/gemini-2.5-flash-lite)
 * 3. Direct Gemini 2.5 Flash
 * 4. Deterministic Heuristic
 */
export async function classifyLeadWithJev(lead: LeadProfileInput): Promise<{
  classification: JevLeadClassification;
  provider: JevDecisionResponse["provider"];
}> {
  // Step 1: Try Mesh API /v1/evaluate
  try {
    const icpPrompt = `Is this prospect an executive decision maker for Seshank AI Labs?
Title: ${lead.title || ""}, Company: ${lead.company || ""}, Industry: ${lead.industry || ""}`;
    const icpRes = await callMeshJevEvaluate(icpPrompt, "Bool");
    const isQualified = Boolean(icpRes.value ?? icpRes.result);

    const offerPrompt = `Select exact offer: 'saas_lead_gen' (ONLY B2B SaaS/software), 'custom_ai_employee' (clinics/agencies/ops/e-com), or 'founder_website' (Real Estate/Construction/Healthcare leaders):
Title: ${lead.title || ""}, Company: ${lead.company || ""}, Industry: ${lead.industry || ""}`;
    const offerRes = await callMeshJevEvaluate(offerPrompt, "Choice", [
      "saas_lead_gen",
      "custom_ai_employee",
      "founder_website",
    ]);
    const targetOffer = offerRes.choice || "custom_ai_employee";

    let aiRole: any = "none";
    if (targetOffer === "custom_ai_employee") {
      const rolePrompt = `Diagnose AI employee role: 'ai_sdr' (agencies), 'ai_receptionist' (clinics/salons), 'ai_ops_copilot' (real estate/construction/logistics ops), 'ai_support_agent' (e-commerce), or 'custom_workflow_agent':
Company: ${lead.company || ""}, Industry: ${lead.industry || ""}`;
      const roleRes = await callMeshJevEvaluate(rolePrompt, "Choice", [
        "ai_sdr",
        "ai_receptionist",
        "ai_ops_copilot",
        "ai_support_agent",
        "custom_workflow_agent",
      ]);
      aiRole = roleRes.choice || "custom_workflow_agent";
    }

    return {
      classification: {
        jev_icp_qualified: isQualified,
        target_offer: targetOffer,
        ai_employee_role: aiRole,
        reasoning: offerRes.reasoning || "Mesh Jev evaluation complete",
        confidence: typeof offerRes.confidence === "number" ? offerRes.confidence : 0.9,
      },
      provider: "mesh_jev_evaluate",
    };
  } catch (err: any) {
    console.warn("Mesh API /v1/evaluate unavailable. Falling back to Mesh /v1/chat/completions:", err.message);
  }

  // Step 2: Try Mesh API /v1/chat/completions with gemini-2.5-flash-lite
  try {
    const chatResult = await callMeshChatFallback(lead);
    return {
      classification: chatResult,
      provider: "mesh_chat_fallback",
    };
  } catch (chatErr: any) {
    console.warn("Mesh chat fallback unavailable. Falling back to Direct Gemini Flash:", chatErr.message);
  }

  // Step 3: Try Direct Gemini API
  try {
    const directResult = await callDirectGeminiFallback(lead);
    return {
      classification: directResult,
      provider: "gemini_direct_fallback",
    };
  } catch (geminiErr: any) {
    console.error("Direct Gemini fallback failed. Using deterministic heuristic:", geminiErr.message);
  }

  // Step 4: Deterministic Heuristic
  return {
    classification: evaluateDeterministicHeuristic(lead),
    provider: "local_heuristic",
  };
}

/**
 * Gate 1: ICP Qualification
 */
export async function evaluateIcpQualification(
  lead: LeadProfileInput
): Promise<JevDecisionResponse<boolean>> {
  const { classification, provider } = await classifyLeadWithJev(lead);
  return {
    result: classification.jev_icp_qualified,
    reasoning: classification.reasoning,
    confidence: classification.confidence,
    provider: provider as any,
  };
}

/**
 * Gate 2: Offer Routing
 */
export async function evaluateOfferRouting(
  lead: LeadProfileInput
): Promise<JevDecisionResponse<"saas_lead_gen" | "custom_ai_employee" | "founder_website">> {
  const { classification, provider } = await classifyLeadWithJev(lead);
  return {
    result: classification.target_offer,
    reasoning: classification.reasoning,
    confidence: classification.confidence,
    provider: provider as any,
  };
}

/**
 * Gate 3: Dynamic AI Employee Role Diagnosis
 */
export async function evaluateAiEmployeeRole(
  lead: LeadProfileInput
): Promise<JevDecisionResponse<"ai_sdr" | "ai_receptionist" | "ai_ops_copilot" | "ai_support_agent" | "custom_workflow_agent">> {
  const { classification, provider } = await classifyLeadWithJev(lead);
  const role = classification.ai_employee_role === "none" ? "custom_workflow_agent" : classification.ai_employee_role;
  return {
    result: role,
    reasoning: classification.reasoning,
    confidence: classification.confidence,
    provider: provider as any,
  };
}

/**
 * Gate 4: Pre-Send QA Gate (Score)
 */
export async function evaluatePreSendQa(
  emailStep1: string,
  wordCount: number,
  evidenceSnippet?: string
): Promise<JevDecisionResponse<number>> {
  const prompt = `Perform executive QA scoring (0.0 to 1.0) on this Step 1 cold email for Seshank AI Labs:
"${emailStep1}"

Strict Rules to Score:
1. Word Count must be strictly under 65 words (Current: ${wordCount}).
2. Zero em dashes (— or --) allowed. Only commas or periods.
3. Zero flattery like "I hope this finds you well" or "Hope all is well".
4. Zero premature pricing or links in Step 1.
5. Peer founder tone: direct, low friction, permission-first.
Output QA Score between 0.0 and 1.0.`;

  try {
    const data = await callMeshJevEvaluate(prompt, "Score");
    const score = typeof data.score === "number" ? data.score : 0.9;
    return {
      result: score,
      reasoning: data.reasoning || "Pre-send QA check complete",
      confidence: 0.9,
      provider: "mesh_jev_evaluate",
    };
  } catch (err: any) {
    // Deterministic QA score calculation
    let score = 1.0;
    const issues: string[] = [];

    if (wordCount > 65) {
      score -= 0.25;
      issues.push(`Over 65 words (${wordCount} words)`);
    }
    if (emailStep1.includes("—") || emailStep1.includes("--")) {
      score -= 0.3;
      issues.push("Contains prohibited em dash");
    }
    if (/hope this.*well|hope you are well|hope all is well/i.test(emailStep1)) {
      score -= 0.3;
      issues.push("Contains banned flattery opener");
    }
    if (/https?:\/\/|www\.|\$\d+|\b\d+\s*(usd|aed|sar)\b/i.test(emailStep1)) {
      score -= 0.25;
      issues.push("Premature link or pricing in Step 1");
    }

    return {
      result: Math.max(0.1, score),
      reasoning: issues.length ? `QA Deductions: ${issues.join("; ")}` : "Passed all local strict QA rules.",
      confidence: 0.95,
      provider: "local_heuristic",
    };
  }
}
