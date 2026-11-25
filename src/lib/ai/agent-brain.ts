import { createAdminClient } from "@/lib/supabase/admin";

export type RegionKey = "KSA" | "UAE" | "UK" | "US" | "OTHER";

// ==============================================================================
// 1. CANONICAL NORMALIZERS
// ==============================================================================

/**
 * Normalizes LinkedIn URLs into a canonical format:
 * - Lowercase & trimmed
 * - Removes http://, https://, www., and country subdomains (e.g. ae.linkedin.com -> linkedin.com)
 * - Strips query parameters (?miniProfileUrn=...)
 * - Strips trailing slashes
 * Output example: "linkedin.com/in/seshank"
 */
export function normalizeLinkedInUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  let url = rawUrl.trim().toLowerCase();

  // Strip query parameters and anchors
  url = url.split("?")[0].split("#")[0];

  // Strip protocol
  url = url.replace(/^https?:\/\//, "");

  // Strip leading www. or country codes like ae.linkedin.com -> linkedin.com
  url = url.replace(/^([a-z]{2}\.)?www\./, "");
  url = url.replace(/^[a-z]{2}\.linkedin\.com/, "linkedin.com");

  // Ensure trailing slashes are removed
  url = url.replace(/\/+$/, "");

  // If user pasted bare username or path, ensure linkedin.com/in prefix
  if (!url.includes("linkedin.com")) {
    const cleanUsername = url.replace(/^\/+/, "").replace(/^in\//, "");
    url = `linkedin.com/in/${cleanUsername}`;
  }

  return url;
}

/**
 * Normalizes company names into clean unique slugs:
 * - Lowercase & trimmed
 * - Strips corporate suffixes (inc, llc, ltd, limited, co, corp, pvt, private, etc.)
 * - Strips non-alphanumeric characters
 * Output example: "Analytics Depot LLC" -> "analyticsdepot"
 */
export function normalizeCompanySlug(rawName: string | null | undefined): string {
  if (!rawName) return "unknown";
  let name = rawName.trim().toLowerCase();

  // Remove corporate suffixes at word boundaries
  name = name.replace(/\b(inc|incorporated|llc|ltd|limited|co|company|corp|corporation|pvt|private|gmbh|sa|bv|fzc|fze)\b/gi, "");

  // Strip all non-alphanumeric characters
  const slug = name.replace(/[^a-z0-9]/g, "");

  return slug.length > 0 ? slug : "company";
}

/**
 * Normalizes web domains:
 * - Strips protocol and www
 * - Lowercases and trims
 * Output example: "https://www.analyticsdepot.com/about" -> "analyticsdepot.com"
 */
export function normalizeDomain(rawDomainOrUrl: string | null | undefined): string | null {
  if (!rawDomainOrUrl) return null;
  let domain = rawDomainOrUrl.trim().toLowerCase();

  // Remove mailto: or protocol
  domain = domain.replace(/^mailto:/, "");
  domain = domain.replace(/^https?:\/\//, "");

  // Remove www.
  domain = domain.replace(/^www\./, "");

  // Take root hostname only (before first slash, colon, or question mark)
  domain = domain.split("/")[0].split(":")[0].split("?")[0];

  // If email was provided, extract domain after @
  if (domain.includes("@")) {
    domain = domain.split("@")[1];
  }

  return domain.length > 0 ? domain : null;
}

/**
 * City & Region Normalizer:
 * Detects regional assignment based on standard priority cities
 */
export function normalizeCityAndRegion(city?: string | null, region?: string | null): { city: string | null; region: RegionKey } {
  const cleanCity = city ? city.trim() : null;
  let detectedRegion: RegionKey = "OTHER";

  if (region && ["KSA", "UAE", "UK", "US", "OTHER"].includes(region.toUpperCase())) {
    detectedRegion = region.toUpperCase() as RegionKey;
  }

  if (cleanCity) {
    const c = cleanCity.toLowerCase();
    if (c.includes("riyadh") || c.includes("jeddah") || c.includes("khobar") || c.includes("dammam") || c.includes("mecca") || c.includes("medina")) {
      detectedRegion = "KSA";
    } else if (c.includes("dubai") || c.includes("abu dhabi") || c.includes("sharjah") || c.includes("ajman")) {
      detectedRegion = "UAE";
    } else if (c.includes("london") || c.includes("manchester") || c.includes("birmingham") || c.includes("cambridge") || c.includes("oxford")) {
      detectedRegion = "UK";
    } else if (
      c.includes("new york") ||
      c.includes("san francisco") ||
      c.includes("austin") ||
      c.includes("chicago") ||
      c.includes("boston") ||
      c.includes("seattle") ||
      c.includes("los angeles")
    ) {
      detectedRegion = "US";
    }
  }

  return { city: cleanCity, region: detectedRegion };
}

// ==============================================================================
// 2. PERPETUAL AGENCY MEMORY (AGENT BRAIN)
// ==============================================================================

export interface AgentBrainState {
  agentName: string;
  region: RegionKey;
  todayRule: {
    dayOfWeek: number;
    dayName: string;
    activeRegions: string[];
    priorityCities: string[];
    emailGoal: number;
    linkedinGoal: number;
    isPrepOnly: boolean;
  };
  quotas: {
    emailsSentToday: number;
    linkedinSentToday: number;
    remainingEmailQuota: number;
    remainingLinkedInQuota: number;
  };
  companyLock: {
    isLocked: boolean;
    lockStatus?: string;
    cooldownUntil?: string | null;
    lockReason?: string;
  };
  relevantLessons: Array<{
    id: string;
    lessonType: string;
    lessonText: string;
  }>;
}

/**
 * Loads perpetual memory, active schedule rules, regional quota allowances,
 * collision locks, and episodic agent lessons for any lead outreach turn.
 */
export async function loadAgentBrain(
  agentName: string,
  region: RegionKey,
  companyId?: string
): Promise<AgentBrainState> {
  const adminClient = createAdminClient();
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday ... 6 = Saturday
  const todayDateStr = today.toISOString().split("T")[0];

  // 1. Fetch Today's Dynamic Schedule Rule
  const { data: scheduleRule } = await adminClient
    .from("daily_schedule_rules")
    .select("*")
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();

  const activeRegions = scheduleRule?.active_regions || ["KSA", "UAE", "UK", "US"];
  const priorityCities = scheduleRule?.priority_cities || [];
  const emailGoal = scheduleRule?.email_goal ?? 25;
  const linkedinGoal = scheduleRule?.linkedin_goal ?? 20;
  const isPrepOnly = scheduleRule?.is_prep_only ?? false;

  // 2. Query Today's Outreach Ledger to compute exact consumed quotas
  const startOfDay = `${todayDateStr}T00:00:00.000Z`;
  const { data: todayLedger } = await adminClient
    .from("outreach_ledger")
    .select("channel, event_type, region")
    .gte("created_at", startOfDay);

  const emailsSentToday = (todayLedger || []).filter(
    (row) => row.channel === "email" && ["step1_sent", "followup_sent"].includes(row.event_type)
  ).length;

  const linkedinSentToday = (todayLedger || []).filter(
    (row) => row.channel.startsWith("linkedin") && ["historical_sent", "connected", "step1_sent"].includes(row.event_type)
  ).length;

  const remainingEmailQuota = Math.max(0, emailGoal - emailsSentToday);
  const remainingLinkedInQuota = Math.max(0, linkedinGoal - linkedinSentToday);

  // 3. Enforce Company-Level Hard Collision Lock
  let companyLock: AgentBrainState["companyLock"] = { isLocked: false };

  if (companyId) {
    const { data: company } = await adminClient
      .from("companies")
      .select("id, company_name, lock_status, cooldown_until, last_contacted_at")
      .eq("id", companyId)
      .maybeSingle();

    if (company && company.lock_status !== "available") {
      const isStillCooldown = company.cooldown_until ? new Date(company.cooldown_until) > today : true;
      if (isStillCooldown) {
        companyLock = {
          isLocked: true,
          lockStatus: company.lock_status,
          cooldownUntil: company.cooldown_until,
          lockReason: `Company "${company.company_name}" is locked (${company.lock_status}). Outreach blocked until ${company.cooldown_until || "manual unlock"}.`,
        };
      }
    }
  }

  // 4. Retrieve Episodic Memory Lessons (Learns from edits, rejections, winning angles)
  const { data: episodes } = await adminClient
    .from("agent_memory_episodes")
    .select("id, lesson_type, lesson_text")
    .or(`region.eq.${region},agent_name.eq.${agentName}`)
    .order("created_at", { ascending: false })
    .limit(5);

  const relevantLessons = (episodes || []).map((e) => ({
    id: e.id,
    lessonType: e.lesson_type,
    lessonText: e.lesson_text,
  }));

  return {
    agentName,
    region,
    todayRule: {
      dayOfWeek,
      dayName: scheduleRule?.day_name || "Today",
      activeRegions,
      priorityCities,
      emailGoal,
      linkedinGoal,
      isPrepOnly,
    },
    quotas: {
      emailsSentToday,
      linkedinSentToday,
      remainingEmailQuota,
      remainingLinkedInQuota,
    },
    companyLock,
    relevantLessons,
  };
}
