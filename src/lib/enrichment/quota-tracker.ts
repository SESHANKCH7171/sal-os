import { createAdminClient } from "@/lib/supabase/admin";

export type QuotaProvider =
  | "apollo"
  | "tavily"
  | "serper"
  | "serpapi"
  | "mesh_jev"
  | "gemini_text"
  | "gemini_image"
  | "groq_whisper"
  | "hostinger_smtp";

// Hard daily safety ceilings from GUARDRAILS_AND_HARDENING.md
export const DAILY_BUDGET_CAPS: Record<QuotaProvider, number> = {
  apollo: 50,          // Free trial safety ceiling
  tavily: 33,          // 1,000 monthly searches / 30 days
  serper: 80,          // 2,500 free queries safety rate
  serpapi: 3,          // 100 free queries / 30 days reserve
  mesh_jev: 500,       // Fast fractional-cost decision engine
  gemini_text: 1400,   // Safe headroom below Google 1,500 RPD
  gemini_image: 50,    // Nano Banana 2.1 visual budget
  groq_whisper: 50,    // Free tier audio transcription
  hostinger_smtp: 10,  // Initial 7-day warmup cap (warmup: 10, scaled: 25)
};

export interface QuotaCheckResult {
  allowed: boolean;
  provider: QuotaProvider;
  currentCount: number;
  dailyCap: number;
  remaining: number;
  reason?: string;
}

/**
 * Checks whether calling an external API provider is within daily safety budget.
 */
export async function checkQuotaAvailable(provider: QuotaProvider): Promise<QuotaCheckResult> {
  const adminClient = createAdminClient();
  const today = new Date().toISOString().split("T")[0];
  const dailyCap = DAILY_BUDGET_CAPS[provider] ?? 100;

  try {
    const { data } = await adminClient
      .from("api_usage_logs")
      .select("requests_count")
      .eq("provider", provider)
      .eq("usage_date", today)
      .maybeSingle();

    const currentCount = data?.requests_count || 0;
    const remaining = Math.max(0, dailyCap - currentCount);
    const allowed = currentCount < dailyCap;

    return {
      allowed,
      provider,
      currentCount,
      dailyCap,
      remaining,
      reason: allowed
        ? undefined
        : `Daily safety budget cap reached for ${provider} (${currentCount}/${dailyCap}). Circuit breaker tripped.`,
    };
  } catch (err: any) {
    console.warn(`Quota check warning for ${provider}:`, err);
    // Allow by default if check fails so transient DB glitch doesn't kill execution
    return {
      allowed: true,
      provider,
      currentCount: 0,
      dailyCap,
      remaining: dailyCap,
    };
  }
}

/**
 * Increments the logged API usage count in Supabase api_usage_logs.
 */
export async function incrementQuota(provider: QuotaProvider, incrementBy = 1): Promise<number> {
  const adminClient = createAdminClient();
  const today = new Date().toISOString().split("T")[0];

  try {
    const { data: current } = await adminClient
      .from("api_usage_logs")
      .select("requests_count")
      .eq("provider", provider)
      .eq("usage_date", today)
      .maybeSingle();

    const newCount = (current?.requests_count || 0) + incrementBy;

    await adminClient
      .from("api_usage_logs")
      .upsert(
        {
          provider,
          usage_date: today,
          requests_count: newCount,
        },
        { onConflict: "provider,usage_date" }
      );

    return newCount;
  } catch (err: any) {
    console.error(`Failed to increment quota for ${provider}:`, err);
    return 0;
  }
}
