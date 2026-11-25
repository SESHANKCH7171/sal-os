"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { 
  Database, 
  Save, 
  RefreshCw, 
  Check, 
  AlertCircle, 
  Code, 
  Briefcase, 
  FileText, 
  Tag, 
  DollarSign, 
  BookOpen, 
  Layers
} from "lucide-react";

export interface BrandOffer {
  id?: string;
  offer_key: "saas_lead_gen" | "custom_ai_employee" | "founder_website";
  display_name: string;
  target_icp: string;
  core_hook: string;
  proof_points: string;
  pricing_notes: string;
  role_playbooks: Record<string, any>;
  writing_rules: string;
  updated_at?: string;
}

const DEFAULT_OFFERS: BrandOffer[] = [
  {
    offer_key: "saas_lead_gen",
    display_name: "B2B Lead Gen for B2B SaaS Companies",
    target_icp: "Founders, CEOs, COOs, Heads of Growth/BD at Seed–Series A B2B SaaS companies (US, UK, UAE, KSA)",
    core_hook: "Permission-first 10-lead free sniper sheet before any commercial pitch",
    proof_points: "Approached 100–150 companies, 3–5 engaged replies, signed Vineet Pinto, CEO of Analytics Depot",
    pricing_notes: "Commercials (Step 3 only, never Step 1 or Step 2): 14-day paid pilot ($850–$900 / AED 3,100 for 30 deeply audited accounts) or performance/retainer model ($200/meeting booked)",
    role_playbooks: {},
    writing_rules: "Zero em dashes. Use periods or commas only. Under 65 words for Step 1 cold emails. No flattery like \"I hope this finds you well\". Sound like a peer founder."
  },
  {
    offer_key: "custom_ai_employee",
    display_name: "Custom AI Employees (Vertical-Agnostic, Dynamically Diagnosed)",
    target_icp: "Founders, Operators, Practice Leaders in Dental Clinics, Medical Practices, Salons, Hospitality, Real Estate, Construction, Logistics, Legal, E-commerce, High-Volume Services, and B2B Agencies (UAE, KSA, UK, US)",
    core_hook: "Deploy turnkey AI Employees directly to eliminate operational bottlenecks, handle client comms 24/7, and recover missed revenue",
    proof_points: "Zero headcount overhead, 24/7 instant response, turnkey integration into existing WhatsApp/Email/CRM workflows with human-in-the-loop oversight",
    pricing_notes: "Setup fee ($1,500–$3,500 / 5,500–12,000 AED/SAR) + monthly maintenance/intelligence retainer ($500–$1,500/mo)",
    role_playbooks: {
      "ai_sdr": {
        "title": "AI SDR / Outbound Specialist",
        "target_verticals": ["B2B SaaS", "Agencies", "Consulting"],
        "workflow": "Account research, buying-signal tracking, outbound drafting, and reply qualification."
      },
      "ai_receptionist": {
        "title": "AI Front Desk & Receptionist",
        "target_verticals": ["Dental Clinics", "Medical Practices", "Salons", "Hospitality"],
        "workflow": "24/7 missed-call recovery, patient/guest qualification, direct calendar booking via WhatsApp/SMS."
      },
      "ai_ops_copilot": {
        "title": "AI Operations & Logistics Copilot",
        "target_verticals": ["Real Estate", "Construction", "Logistics", "Legal"],
        "workflow": "Inquiry intake, quote/document parsing, CRM updates, vendor follow-ups, and discrepancy alerts."
      },
      "ai_support_agent": {
        "title": "AI Tier-1 Customer Support Specialist",
        "target_verticals": ["E-commerce", "High-Volume Services"],
        "workflow": "Tier-1 ticket resolution, booking/order status lookups, returns processing, clean escalation to human staff."
      },
      "custom_workflow_agent": {
        "title": "Custom Workflow Automator",
        "target_verticals": ["Any niche with operational bottlenecks"],
        "workflow": "Automates specific repetitive operational bottlenecks identified through site audits and hiring signals."
      }
    },
    writing_rules: "Zero em dashes. Direct, pain-focused, pragmatic. Highlight operational efficiency and instant ROI."
  },
  {
    offer_key: "founder_website",
    display_name: "High-Profile Founder Websites (Traditional Non-Tech Industries)",
    target_icp: "High-profile Founders, Managing Directors, Principals, and Partners in Real Estate, Construction, Healthcare, and traditional non-tech industries (UAE, KSA, UK, US)",
    core_hook: "Bespoke 1-page personal executive websites (firstname-lastname.com positioning) that build instant authority for referrals, partners, and investors",
    proof_points: "Executive personal branding converts institutional capital, top talent, and elite joint ventures far better than corporate landing pages",
    pricing_notes: "$750–$850 USD (US/UK) | 3,500 SAR / AED (KSA/UAE)",
    role_playbooks: {},
    writing_rules: "Zero em dashes. Prestigious, respectful, peer-to-peer tone. Emphasize executive presence and digital authority."
  }
];

export default function BrandVaultEditor() {
  const [offers, setOffers] = useState<BrandOffer[]>(DEFAULT_OFFERS);
  const [selectedOfferKey, setSelectedOfferKey] = useState<BrandOffer["offer_key"]>("saas_lead_gen");
  const [rawPlaybooksJson, setRawPlaybooksJson] = useState<string>("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const supabase = createClient();

  // Load offers from Supabase brand_vault table
  const fetchOffers = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const { data, error } = await supabase
        .from("brand_vault")
        .select("*")
        .order("offer_key");

      if (error) {
        console.warn("Could not fetch brand_vault from Supabase:", error.message);
        setStatusMessage({
          text: `Supabase load notice: ${error.message}. Displaying local default offers.`,
          type: "error",
        });
      } else if (data && data.length > 0) {
        const merged = DEFAULT_OFFERS.map((def) => {
          const remote = data.find((d: any) => d.offer_key === def.offer_key);
          return remote ? { ...def, ...remote } : def;
        });
        setOffers(merged);
        const current = merged.find((o) => o.offer_key === selectedOfferKey) || merged[0];
        setRawPlaybooksJson(JSON.stringify(current.role_playbooks || {}, null, 2));
      } else {
        // Table is empty, initialize raw JSON
        const current = DEFAULT_OFFERS.find((o) => o.offer_key === selectedOfferKey)!;
        setRawPlaybooksJson(JSON.stringify(current.role_playbooks || {}, null, 2));
      }
    } catch (err: any) {
      console.error("Error loading brand_vault:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOffers();
  }, []);

  const currentOffer = offers.find((o) => o.offer_key === selectedOfferKey) || offers[0];

  useEffect(() => {
    if (currentOffer) {
      setRawPlaybooksJson(JSON.stringify(currentOffer.role_playbooks || {}, null, 2));
      setJsonError(null);
    }
  }, [selectedOfferKey]);

  const handleFieldChange = (field: keyof BrandOffer, value: any) => {
    setOffers((prev) =>
      prev.map((o) => (o.offer_key === selectedOfferKey ? { ...o, [field]: value } : o))
    );
  };

  const handleJsonChange = (val: string) => {
    setRawPlaybooksJson(val);
    try {
      const parsed = JSON.parse(val);
      setJsonError(null);
      handleFieldChange("role_playbooks", parsed);
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  const handleSave = async () => {
    if (jsonError) {
      setStatusMessage({ text: "Please fix JSON syntax errors before saving.", type: "error" });
      return;
    }

    setSaving(true);
    setStatusMessage(null);

    try {
      const payload = {
        offer_key: currentOffer.offer_key,
        display_name: currentOffer.display_name,
        target_icp: currentOffer.target_icp,
        core_hook: currentOffer.core_hook,
        proof_points: currentOffer.proof_points,
        pricing_notes: currentOffer.pricing_notes,
        role_playbooks: currentOffer.role_playbooks || {},
        writing_rules: currentOffer.writing_rules,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("brand_vault")
        .upsert(payload, { onConflict: "offer_key" })
        .select();

      if (error) {
        throw error;
      }

      setStatusMessage({ text: `Brand Vault: "${currentOffer.display_name}" saved to Supabase!`, type: "success" });
    } catch (err: any) {
      console.error("Failed to save brand_vault:", err);
      setStatusMessage({ text: `Save error: ${err.message || "Failed to commit to Supabase"}`, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#111420] border border-[#232838] p-5 rounded-xl">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
              Brand Vault & Role Playbook Editor
              <span className="text-[10px] font-mono uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded">
                Live Supabase R/W
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Configures the 3 core flagship offers and dynamic AI employee role playbooks used by Jev & Gemini.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchOffers}
            disabled={loading || saving}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg border border-[#232838] bg-[#0E111A] text-xs text-slate-300 hover:text-white hover:bg-[#1A1F2E] transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Reload</span>
          </button>
          <button
            onClick={handleSave}
            disabled={saving || Boolean(jsonError)}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium shadow-md shadow-indigo-600/20 transition disabled:opacity-50"
          >
            {saving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Save to Supabase</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-center space-x-2 font-mono ${
            statusMessage.type === "success"
              ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
              : "bg-red-950/40 border-red-800/50 text-red-300"
          }`}
        >
          {statusMessage.type === "success" ? (
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Offer Switcher Tabs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {offers.map((offer) => {
          const isSelected = offer.offer_key === selectedOfferKey;
          return (
            <button
              key={offer.offer_key}
              onClick={() => setSelectedOfferKey(offer.offer_key)}
              className={`p-4 rounded-xl border text-left transition-all relative overflow-hidden ${
                isSelected
                  ? "bg-[#141826] border-indigo-500 shadow-md shadow-indigo-500/10"
                  : "bg-[#0E111A] border-[#232838] hover:border-slate-600 text-slate-400 hover:text-slate-200"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-indigo-400">
                  {offer.offer_key}
                </span>
                {isSelected && (
                  <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-slate-100 line-clamp-1">
                {offer.display_name}
              </h3>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                {offer.core_hook}
              </p>
            </button>
          );
        })}
      </div>

      {/* Active Offer Fields Editor */}
      <div className="bg-[#111420] border border-[#232838] rounded-xl p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Display Name */}
          <div>
            <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 font-mono">
              <Briefcase className="w-3.5 h-3.5 text-indigo-400" />
              <span>Offer Display Name</span>
            </label>
            <input
              type="text"
              value={currentOffer.display_name}
              onChange={(e) => handleFieldChange("display_name", e.target.value)}
              className="w-full rounded-lg bg-[#0A0D15] border border-[#232838] px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Pricing Notes */}
          <div>
            <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 font-mono">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              <span>Commercials & Pricing Rules</span>
            </label>
            <input
              type="text"
              value={currentOffer.pricing_notes}
              onChange={(e) => handleFieldChange("pricing_notes", e.target.value)}
              className="w-full rounded-lg bg-[#0A0D15] border border-[#232838] px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Target ICP */}
        <div>
          <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 font-mono">
            <Tag className="w-3.5 h-3.5 text-purple-400" />
            <span>Target Ideal Customer Profile (ICP)</span>
          </label>
          <textarea
            rows={2}
            value={currentOffer.target_icp}
            onChange={(e) => handleFieldChange("target_icp", e.target.value)}
            className="w-full rounded-lg bg-[#0A0D15] border border-[#232838] px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-mono text-xs"
          />
        </div>

        {/* Core Hook & Proof Points */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 font-mono">
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span>Core Value Hook</span>
            </label>
            <textarea
              rows={3}
              value={currentOffer.core_hook}
              onChange={(e) => handleFieldChange("core_hook", e.target.value)}
              className="w-full rounded-lg bg-[#0A0D15] border border-[#232838] px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 font-mono">
              <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
              <span>Verified Proof Points</span>
            </label>
            <textarea
              rows={3}
              value={currentOffer.proof_points}
              onChange={(e) => handleFieldChange("proof_points", e.target.value)}
              className="w-full rounded-lg bg-[#0A0D15] border border-[#232838] px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Writing Rules */}
        <div>
          <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 font-mono">
            <Layers className="w-3.5 h-3.5 text-rose-400" />
            <span>Strict Writing & Tone Rules</span>
          </label>
          <textarea
            rows={2}
            value={currentOffer.writing_rules}
            onChange={(e) => handleFieldChange("writing_rules", e.target.value)}
            className="w-full rounded-lg bg-[#0A0D15] border border-[#232838] px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-mono text-xs"
          />
        </div>

        {/* Dynamic Role Playbooks JSON Editor (Particularly for Offer 2) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono">
              <Code className="w-3.5 h-3.5 text-indigo-400" />
              <span>Role Playbooks (JSON Specification)</span>
            </label>
            {jsonError ? (
              <span className="text-[11px] text-red-400 font-mono flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Invalid JSON: {jsonError}
              </span>
            ) : (
              <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                <Check className="w-3 h-3" />
                JSON Valid
              </span>
            )}
          </div>
          <div className="relative">
            <textarea
              rows={10}
              value={rawPlaybooksJson}
              onChange={(e) => handleJsonChange(e.target.value)}
              className={`w-full rounded-lg bg-[#080A10] border px-3.5 py-3 font-mono text-xs text-indigo-300 focus:outline-none ${
                jsonError ? "border-red-500/80" : "border-[#232838] focus:border-indigo-500"
              }`}
            />
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Dynamic role definitions (e.g. <code className="text-indigo-400">ai_sdr</code>, <code className="text-indigo-400">ai_receptionist</code>, <code className="text-indigo-400">ai_ops_copilot</code>) are referenced directly by the Jev decision engine.
          </p>
        </div>
      </div>
    </div>
  );
}
