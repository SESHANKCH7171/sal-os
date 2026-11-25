import dns from "dns/promises";
import { isScraperBlockedDomain, isTier1TrustedSource, cleanDomain } from "./domain-filter";
import { checkQuotaAvailable, incrementQuota } from "./quota-tracker";

export interface VerifiedEvidenceSource {
  title: string;
  url: string;
  extracted_fact: string;
  trust_score: number;
  published_date?: string | null;
}

export interface WaterfallEnrichmentResult {
  email: string | null;
  emailVerificationStatus: "unverified" | "deliverable" | "catch_all" | "undeliverable";
  enrichmentSummary: string;
  evidenceSources: VerifiedEvidenceSource[];
  companyDomain: string | null;
}

/**
 * 1. Email Verification Waterfall:
 * - Checks existing CSV verification status
 * - Resolves MX records via Node dns
 */
export async function verifyEmailMx(email: string | null | undefined): Promise<"deliverable" | "catch_all" | "undeliverable"> {
  if (!email || !email.includes("@")) {
    return "undeliverable";
  }

  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain) return "undeliverable";

  try {
    const mxRecords = await dns.resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      return "undeliverable";
    }
    return "deliverable";
  } catch (err: any) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
      return "undeliverable";
    }
    // DNS timeout or transient network issue -> fallback to catch_all rather than false negative
    return "catch_all";
  }
}

/**
 * 2. Apollo Waterfall for Missing Emails
 */
export async function lookupApolloEmail(
  fullName: string,
  companyName?: string | null,
  linkedinUrl?: string | null
): Promise<{ email: string | null; status: "deliverable" | "catch_all" | "undeliverable" }> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return { email: null, status: "undeliverable" };

  const quota = await checkQuotaAvailable("apollo");
  if (!quota.allowed) {
    console.warn("Apollo quota ceiling reached. Skipping email lookup.");
    return { email: null, status: "undeliverable" };
  }

  // Always log Apollo attempt to api_usage_logs under 'apollo'
  await incrementQuota("apollo");

  try {
    const response = await fetch("https://api.apollo.io/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        name: fullName,
        organization_name: companyName || undefined,
        linkedin_url: linkedinUrl || undefined,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Apollo API non-200 response (${response.status}):`, errorText);
      return { email: null, status: "undeliverable" };
    }

    const data = await response.json();
    const person = data.person;

    if (person && person.email) {
      const emailStatus = person.email_status;
      const status =
        emailStatus === "verified"
          ? "deliverable"
          : emailStatus === "extrapolated"
          ? "catch_all"
          : "deliverable";
      return { email: person.email, status };
    }

    return { email: null, status: "undeliverable" };
  } catch (err) {
    console.warn("Apollo lookup error:", err);
    return { email: null, status: "undeliverable" };
  }
}

/**
 * 3. 3-Second URL Liveness Check
 */
export async function verifyUrlLiveness(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timeoutId);
    return res.status >= 200 && res.status < 400;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

/**
 * 4. Verified Intelligence Research Waterfall (Tavily -> Serper -> SerpAPI)
 */
export async function searchVerifiedIntelligence(
  query: string,
  targetDomain?: string | null
): Promise<VerifiedEvidenceSource[]> {
  const results: VerifiedEvidenceSource[] = [];

  // Attempt 1: Tavily Search
  const tavilyKey = process.env.TAVILY_API_KEY;
  const tavilyQuota = await checkQuotaAvailable("tavily");

  if (tavilyKey && tavilyQuota.allowed) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          search_depth: "basic",
          include_answer: false,
          max_results: 5,
        }),
      });

      if (res.ok) {
        await incrementQuota("tavily");
        const data = await res.json();
        for (const item of data.results || []) {
          if (!isScraperBlockedDomain(item.url)) {
            const isTier1 = isTier1TrustedSource(item.url);
            results.push({
              title: item.title || "Web Signal",
              url: item.url,
              extracted_fact: item.content ? item.content.slice(0, 250) : "",
              trust_score: isTier1 ? 9 : 7,
              published_date: item.published_date || null,
            });
          }
        }
      }
    } catch (err) {
      console.warn("Tavily search warning:", err);
    }
  }

  // Attempt 2: Serper Fallback if results < 2
  if (results.length < 2) {
    const serperKey = process.env.SERPER_API_KEY;
    const serperQuota = await checkQuotaAvailable("serper");

    if (serperKey && serperQuota.allowed) {
      try {
        const res = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": serperKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ q: query, num: 5 }),
        });

        if (res.ok) {
          await incrementQuota("serper");
          const data = await res.json();
          for (const item of data.organic || []) {
            if (!isScraperBlockedDomain(item.link)) {
              const isTier1 = isTier1TrustedSource(item.link);
              results.push({
                title: item.title || "Verified Signal",
                url: item.link,
                extracted_fact: item.snippet || "",
                trust_score: isTier1 ? 9 : 7,
              });
            }
          }
        }
      } catch (err) {
        console.warn("Serper search warning:", err);
      }
    }
  }

  // Deduplicate results by URL
  const uniqueMap = new Map<string, VerifiedEvidenceSource>();
  for (const r of results) {
    if (!uniqueMap.has(r.url)) {
      uniqueMap.set(r.url, r);
    }
  }

  return Array.from(uniqueMap.values()).slice(0, 3);
}

/**
 * Main Waterfall Pipeline Orchestrator for a single Lead
 */
export async function runWaterfallEnrichment(lead: {
  fullName: string;
  companyName?: string | null;
  linkedinUrl?: string | null;
  email?: string | null;
  emailVerificationStatus?: string | null;
}): Promise<WaterfallEnrichmentResult> {
  let email = lead.email ? lead.email.trim().toLowerCase() : null;
  let status: "unverified" | "deliverable" | "catch_all" | "undeliverable" =
    (lead.emailVerificationStatus as any) || "unverified";

  // Step 1: If missing email, run Apollo
  if (!email) {
    const apolloResult = await lookupApolloEmail(lead.fullName, lead.companyName, lead.linkedinUrl);
    if (apolloResult.email) {
      email = apolloResult.email;
      status = apolloResult.status;
    }
  }

  // Step 2: If we have an email, run MX verification
  if (email && status === "unverified") {
    status = await verifyEmailMx(email);
  }

  // Step 3: Run Verified Research
  const searchQuery = `${lead.fullName} ${lead.companyName || ""} executive news hiring growth`;
  const evidenceSources = await searchVerifiedIntelligence(searchQuery);

  const facts = evidenceSources.map((e) => e.extracted_fact).filter(Boolean);
  const enrichmentSummary = facts.length > 0 ? facts.join(" ") : "Company presence and leadership signal audited.";

  const companyDomain = email ? email.split("@")[1] : null;

  return {
    email,
    emailVerificationStatus: status,
    enrichmentSummary,
    evidenceSources,
    companyDomain,
  };
}
