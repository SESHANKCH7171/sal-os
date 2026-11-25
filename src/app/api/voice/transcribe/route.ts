import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/ai/groq-whisper";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // 1. Single-user authentication verification
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const allowedEmail = (
      process.env.ALLOWED_USER_EMAIL || "seshank@seshankailabs.com"
    ).toLowerCase().trim();

    if (!user || user.email?.toLowerCase().trim() !== allowedEmail) {
      return NextResponse.json(
        { error: "Unauthorized access. Locked to single executive user." },
        { status: 401 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as Blob | File | null;
    const mode = (formData.get("mode") as string) || "content_idea"; // 'content_idea' | 'image_tweak' | 'quick_lead'

    if (!file) {
      return NextResponse.json({ error: "No audio file provided in request" }, { status: 400 });
    }

    const filename = file instanceof File && file.name ? file.name : "recording.webm";
    const transcript = await transcribeAudio(file, filename);

    // 2. Track Groq Whisper API usage in api_usage_logs
    try {
      const adminClient = createAdminClient();
      const today = new Date().toISOString().split("T")[0];
      
      const { data: currentLog } = await adminClient
        .from("api_usage_logs")
        .select("requests_count")
        .eq("provider", "groq_whisper")
        .eq("usage_date", today)
        .maybeSingle();

      const newCount = (currentLog?.requests_count || 0) + 1;

      await adminClient
        .from("api_usage_logs")
        .upsert(
          {
            provider: "groq_whisper",
            usage_date: today,
            requests_count: newCount,
          },
          { onConflict: "provider,usage_date" }
        );
    } catch (logErr) {
      console.warn("Failed to increment groq_whisper in api_usage_logs:", logErr);
    }

    // 3. If mode is 'quick_lead', extract structured lead JSON using Gemini 2.5 Flash
    let leadData = null;
    if (mode === "quick_lead" && transcript) {
      try {
        const geminiApiKey = process.env.GEMINI_API_KEY;
        const geminiModel = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";

        if (geminiApiKey) {
          const extractionPrompt = `You are the lead intake assistant for Seshank AI Labs.
Extract a structured lead object from this spoken transcription:
"${transcript}"

Output valid JSON only with this exact structure:
{
  "full_name": "string",
  "first_name": "string",
  "title": "string or null",
  "company": "string or null",
  "industry": "string or null",
  "linkedin_url": "string or null",
  "email": "string or null",
  "city": "string or null",
  "location_region": "KSA | UAE | UK | US | OTHER",
  "notes": "string or null"
}
Rules:
- If first_name is not explicitly stated, extract it from full_name.
- If city is Riyadh, Jeddah, Khobar, or Dammam, set location_region to 'KSA'.
- If city is Dubai or Abu Dhabi, set location_region to 'UAE'.
- If city is London, set location_region to 'UK'.
- Return ONLY the JSON object without markdown formatting.`;

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: extractionPrompt }] }],
                generationConfig: {
                  responseMimeType: "application/json",
                  temperature: 0.1,
                },
              }),
            }
          );

          if (res.ok) {
            const jsonRes = await res.json();
            const textResponse = jsonRes.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textResponse) {
              leadData = JSON.parse(textResponse);
            }
          }
        }
      } catch (extractErr) {
        console.warn("Quick lead extraction warning:", extractErr);
      }
    }

    return NextResponse.json({
      success: true,
      transcript,
      mode,
      leadData,
    });
  } catch (err: any) {
    console.error("Voice transcribe endpoint error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to transcribe audio" },
      { status: 500 }
    );
  }
}
