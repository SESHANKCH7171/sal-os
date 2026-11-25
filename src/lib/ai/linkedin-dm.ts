import { incrementQuota } from "@/lib/enrichment/quota-tracker";

export interface PostConnectDmInput {
  fullName: string;
  firstName?: string | null;
  title?: string | null;
  company?: string | null;
  targetOffer?: string | null;
  aiEmployeeRole?: string | null;
  enrichmentSummary?: string | null;
}

const BANNED_PITCH_SLAPS = [
  /open to a quick chat/i,
  /hop on a call/i,
  /jump on a call/i,
  /quick call/i,
  /eliminate operational bottlenecks/i,
  /maximize roi/i,
  /synergy/i,
  /game changer/i,
  /cutting-edge/i,
];

function sanitizeDm(raw: string): string {
  return raw
    .replace(/^["']|["']$/g, "")
    .replace(/[\u2014\u2013]/g, ", ")
    .replace(/\s*--\s*/g, ", ")
    .trim();
}

function isValidDm(text: string): boolean {
  if (!text) return false;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const hasBanned = BANNED_PITCH_SLAPS.some((rx) => rx.test(text));
  // Never allow truncated outputs (e.g. "Hey Vineet,") or overly long pitches
  return wordCount >= 12 && wordCount <= 45 && !hasBanned;
}

/**
 * Generates a strict zero-pitch, < 40 word, WhatsApp-style peer LinkedIn post-connect DM
 * with zero em dashes.
 */
export async function generateZeroPitchPostConnectDm(
  lead: PostConnectDmInput
): Promise<string> {
  const firstName = (lead.firstName || lead.fullName.split(" ")[0] || "there").trim();
  const offer = lead.targetOffer || "custom_ai_employee";
  const company = lead.company || "your team";

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";

  let offerInstruction = "";
  if (offer === "saas_lead_gen") {
    offerInstruction = `Offer a free 10-lead sniper sheet tailored to ${company} with zero pitch. End with something like "Mind if I drop the sheet here?"`;
  } else if (offer === "founder_website") {
    offerInstruction = `Mention mocking up a quick 1-page personal founder concept for ${firstName} and ask permission to share the link.`;
  } else {
    offerInstruction = `Ask 1 frictionless operational question relevant to ${company} (e.g., "Quick question, do most new client inquiries come via WhatsApp or phone right now?").`;
  }

  const prompt = `Write a LinkedIn post-connection DM from Seshank Chinnapotula to ${lead.fullName} (${lead.title || "Founder"} at ${company}).

Context: ${lead.enrichmentSummary || "Accepted blank LinkedIn connection request."}

STRICT RULES:
1. Between 15 and 40 words total.
2. WhatsApp-style casual peer tone. Thank them briefly or acknowledge connecting, then: ${offerInstruction}
3. ZERO em dashes (never use — or --). Use commas or periods only.
4. STRICTLY BAN pitch-slaps: NEVER say "open to a quick chat?", "hop on a call", "quick call", "eliminate operational bottlenecks", "maximize ROI", or any salesy fluff.
5. Output ONLY the plain DM text, no quotes, no labels.`;

  if (apiKey) {
    try {
      await incrementQuota("gemini_text");
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

      if (res.ok) {
        const data = await res.json();
        const text = sanitizeDm(data.candidates?.[0]?.content?.parts?.[0]?.text || "");
        if (isValidDm(text)) {
          return text;
        }
        console.warn("Direct Gemini DM failed validation (length/banned), trying Mesh fallback:", text);
      }
    } catch (err) {
      console.warn("Gemini post-connect DM failed, trying Mesh fallback:", (err as Error).message);
    }
  }

  // Mesh API fallback (google/gemini-2.5-flash-lite)
  const meshKey = process.env.MESH_API_KEY;
  if (meshKey) {
    try {
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
              { role: "system", content: "You write concise WhatsApp-style peer LinkedIn DMs. Output plain text only." },
              { role: "user", content: prompt },
            ],
            max_tokens: 512,
            temperature: 0.4,
          }),
          signal: AbortSignal.timeout(45000),
        }
      );

      if (meshRes.ok) {
        const meshData = await meshRes.json();
        const text = sanitizeDm(meshData.choices?.[0]?.message?.content || "");
        if (isValidDm(text)) {
          return text;
        }
      }
    } catch (meshErr) {
      console.warn("Mesh DM fallback failed:", (meshErr as Error).message);
    }
  }

  // Deterministic zero-pitch fallback
  if (offer === "saas_lead_gen") {
    return `Thanks for connecting, ${firstName}. Put together a quick 10-lead sniper sheet of companies matching ${company}'s ICP. Mind if I drop the sheet here?`;
  }
  if (offer === "founder_website") {
    return `Thanks for connecting, ${firstName}. Mocked up a quick 1-page founder concept for your profile. Mind if I share the link here?`;
  }
  return `Thanks for connecting, ${firstName}. Quick question, do most new client inquiries at ${company} come via WhatsApp or phone right now?`;
}
