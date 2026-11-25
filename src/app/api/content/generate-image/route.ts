import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkQuotaAvailable, incrementQuota } from "@/lib/enrichment/quota-tracker";

export const dynamic = "force-dynamic";

async function callGeminiImageModel(model: string, prompt: string, apiKey: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Create a high-contrast dark-mode executive LinkedIn visual graphic. Clean modern UI aesthetic, deep slate #0A0D15 background, crisp typography, zero clutter. Brief: ${prompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
        },
      }),
      signal: AbortSignal.timeout(20000),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Model ${model} HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p: any) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    throw new Error(`Model ${model} returned no inline image data`);
  }

  return {
    mimeType: imagePart.inlineData.mimeType || "image/png",
    base64: imagePart.inlineData.data,
  };
}

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

    const { prompt } = await req.json();
    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Missing image prompt" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const quota = await checkQuotaAvailable("gemini_image");
    if (!quota.allowed) {
      return NextResponse.json({ error: quota.reason }, { status: 429 });
    }

    await incrementQuota("gemini_image");

    const primaryModel = process.env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1";
    const fallbackModel = "gemini-3.1-flash-lite-image";

    let result: { mimeType: string; base64: string } | null = null;
    let modelUsed = primaryModel;
    const errors: string[] = [];

    try {
      result = await callGeminiImageModel(primaryModel, prompt, apiKey);
    } catch (err1: any) {
      errors.push(err1.message);
      console.warn(`Primary image model ${primaryModel} failed, trying fallback ${fallbackModel}:`, err1.message);
      try {
        modelUsed = fallbackModel;
        result = await callGeminiImageModel(fallbackModel, prompt, apiKey);
      } catch (err2: any) {
        errors.push(err2.message);
      }
    }

    if (!result) {
      return NextResponse.json(
        {
          error:
            "Image generation is restricted or unavailable on the current Gemini API key tier. Details: " +
            errors.join(" | "),
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      modelUsed,
      imageDataUrl: `data:${result.mimeType};base64,${result.base64}`,
    });
  } catch (err: any) {
    console.error("Content generate-image error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate visual asset" },
      { status: 500 }
    );
  }
}
