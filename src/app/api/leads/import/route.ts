import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeLinkedInUrl,
  normalizeCompanySlug,
  normalizeDomain,
  normalizeCityAndRegion,
} from "@/lib/ai/agent-brain";

export const dynamic = "force-dynamic";

/**
 * Auto-mapper matching case-insensitively (stripping spaces/underscores/hyphens)
 * for all common Sales Navigator, Apollo, and PhantomBuster LinkedIn headers:
 * linkedin url, linkedin_url, linkedin, person linkedin url, profile url,
 * linkedin profile, linkedinprofileurl, vmid_url, sales navigator url
 */
function extractLinkedInUrl(raw: Record<string, any>): string | null {
  if (!raw || typeof raw !== "object") return null;

  const targetKeys = [
    "linkedinurl",
    "linkedin",
    "personlinkedinurl",
    "profileurl",
    "linkedinprofile",
    "linkedinprofileurl",
    "vmidurl",
    "salesnavigatorurl",
    "salesnavigatorprofileurl",
    "salesnavigatorprofile",
    "memberurl",
  ];

  for (const [key, val] of Object.entries(raw)) {
    if (!val || typeof val !== "string") continue;
    const cleanKey = key.toLowerCase().replace(/[\s_\-]+/g, "");
    if (targetKeys.includes(cleanKey)) {
      const trimmed = val.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }

  // Fallback: check if any value itself looks like a linkedin url
  for (const [key, val] of Object.entries(raw)) {
    if (
      typeof val === "string" &&
      (val.includes("linkedin.com/in/") ||
        val.includes("linkedin.com/sales/") ||
        val.includes("linkedin.com/"))
    ) {
      const trimmed = val.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }

  return null;
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
      return NextResponse.json(
        { error: "Unauthorized access. Single-user locked." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { mode = "mode_a", leads = [], queueForFollowups = false } = body;

    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json({ error: "No leads data provided in request" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    let insertedCount = 0;
    let duplicateCount = 0;
    let lockedCompaniesCount = 0;
    const errors: string[] = [];

    // Process each lead with canonical deduplication
    for (const raw of leads) {
      try {
        const rawFullName = (raw.full_name || raw.name || `${raw.first_name || ""} ${raw.last_name || ""}`).trim();
        if (!rawFullName) continue;

        const firstName = (raw.first_name || rawFullName.split(" ")[0] || "There").trim();
        const rawEmail = raw.email ? raw.email.trim().toLowerCase() : null;
        const rawLinkedInUrl = extractLinkedInUrl(raw);
        const normalizedLinkedIn = normalizeLinkedInUrl(rawLinkedInUrl);
        const companyName = (raw.company || raw.organization_name || raw.company_name || "").trim();
        const companySlug = normalizeCompanySlug(companyName);
        const normalizedDomain = normalizeDomain(raw.domain || raw.website || rawEmail);

        const { city, region } = normalizeCityAndRegion(raw.city, raw.location_region || raw.region);

        // Deduplication Check 1: Check existing lead by lower(email) or normalized_linkedin_url
        let existingLead = null;
        if (rawEmail) {
          const { data } = await adminClient
            .from("leads")
            .select("id")
            .eq("email", rawEmail)
            .maybeSingle();
          if (data) existingLead = data;
        }

        if (!existingLead && normalizedLinkedIn) {
          const { data } = await adminClient
            .from("leads")
            .select("id")
            .eq("normalized_linkedin_url", normalizedLinkedIn)
            .maybeSingle();
          if (data) existingLead = data;
        }

        if (existingLead) {
          duplicateCount++;
          continue;
        }

        // Company Deduplication & Resolution
        let companyId = null;
        if (companyName) {
          const { data: existingCompany } = await adminClient
            .from("companies")
            .select("id, lock_status")
            .eq("company_slug", companySlug)
            .maybeSingle();

          if (existingCompany) {
            companyId = existingCompany.id;
          } else {
            // Create company record
            const { data: newCompany } = await adminClient
              .from("companies")
              .insert({
                company_name: companyName,
                company_slug: companySlug,
                normalized_domain: normalizedDomain,
                city,
                region,
                lock_status: mode === "mode_b" ? "contacted_cooldown" : "available",
                cooldown_until:
                  mode === "mode_b"
                    ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
                    : null,
                last_contacted_at: mode === "mode_b" ? new Date().toISOString() : null,
              })
              .select("id")
              .single();

            if (newCompany) {
              companyId = newCompany.id;
              if (mode === "mode_b") lockedCompaniesCount++;
            }
          }
        }

        // Determine vault stage & historical tracking
        const isHistorical = mode === "mode_b";
        const vaultStage = isHistorical
          ? queueForFollowups
            ? "queued_for_today"
            : "completed"
          : "vaulted";

        const { data: insertedLead, error: insertError } = await adminClient
          .from("leads")
          .insert({
            company_id: companyId,
            full_name: rawFullName,
            first_name: firstName,
            title: raw.title || null,
            company: companyName || null,
            industry: raw.industry || null,
            linkedin_url: rawLinkedInUrl || null,
            normalized_linkedin_url: normalizedLinkedIn,
            email: rawEmail,
            city,
            location_region: region,
            is_historical_import: isHistorical,
            vault_stage: vaultStage,
            email_verification_status: raw.email_verification_status || "unverified",
            email_status: isHistorical ? (queueForFollowups ? "pending" : "step1_sent") : "pending",
            linkedin_status: isHistorical ? "sent" : "pending",
          })
          .select("id")
          .single();

        if (insertError) {
          errors.push(insertError.message);
          continue;
        }

        insertedCount++;

        // In Mode B: Write historical_sent event to outreach_ledger
        if (isHistorical && insertedLead) {
          await adminClient.from("outreach_ledger").insert({
            company_id: companyId,
            lead_id: insertedLead.id,
            agent_name: "manual_import",
            channel: rawEmail ? "email" : "linkedin_blank_connect",
            event_type: "historical_sent",
            region,
            city,
            summary: `Historical outreach import: previously contacted ${rawFullName} at ${companyName}.`,
            metadata: {
              source: "historical_csv_backfill",
              queue_for_followup: queueForFollowups,
            },
          });
        }
      } catch (rowErr: any) {
        errors.push(rowErr.message || "Failed row processing");
      }
    }

    return NextResponse.json({
      success: true,
      mode,
      stats: {
        totalReceived: leads.length,
        inserted: insertedCount,
        duplicatesSkipped: duplicateCount,
        lockedCompanies: lockedCompaniesCount,
      },
      errors: errors.slice(0, 5),
    });
  } catch (err: any) {
    console.error("Lead import endpoint error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to import leads" },
      { status: 500 }
    );
  }
}
