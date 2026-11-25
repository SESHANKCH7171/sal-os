"use client";

import { useEffect, useState, useRef } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import VoiceRecorderButton, { QuickLeadExtracted } from "@/components/VoiceRecorderButton";
import {
  Upload,
  Users,
  History,
  Play,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  Clock,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
  Plus,
  Sparkles,
  ArrowRight,
} from "lucide-react";

export interface LeadRecord {
  id: string;
  full_name: string;
  first_name: string;
  title: string | null;
  company: string | null;
  industry: string | null;
  linkedin_url: string | null;
  email: string | null;
  city: string | null;
  location_region: string;
  vault_stage: string;
  jev_icp_qualified: boolean | null;
  target_offer: string | null;
  ai_employee_role: string | null;
  email_status: string;
  linkedin_status: string;
  email_subject: string | null;
  email_step1: string | null;
  needs_human_review: boolean;
  agent_reasoning: any;
  created_at: string;
}

export default function LeadsPage() {
  const [activeTab, setActiveTab] = useState<"mode_a" | "mode_b" | "vault">("vault");
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);

  // CSV Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importStats, setImportStats] = useState<any | null>(null);
  const [queueForFollowups, setQueueForFollowups] = useState(false);
  const fileInputRefA = useRef<HTMLInputElement | null>(null);
  const fileInputRefB = useRef<HTMLInputElement | null>(null);

  // Voice Lead Capture Drawer
  const [voiceLead, setVoiceLead] = useState<QuickLeadExtracted | null>(null);
  const [savingVoiceLead, setSavingVoiceLead] = useState(false);

  const supabase = createClient();

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Error fetching leads:", error.message);
      } else if (data) {
        setLeads(data);
      }
    } catch (err) {
      console.error("Error fetching leads:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  // CSV Upload Handler
  const handleCsvUpload = (file: File, mode: "mode_a" | "mode_b") => {
    setIsImporting(true);
    setImportStats(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rawRows = results.data as Record<string, any>[];

          const cleanKey = (k: string) => k.toLowerCase().replace(/[\s_\-]+/g, "");

          const getField = (row: Record<string, any>, aliases: string[]) => {
            const cleanAliases = aliases.map(cleanKey);
            for (const [key, val] of Object.entries(row)) {
              if (val !== undefined && val !== null && String(val).trim() !== "") {
                if (cleanAliases.includes(cleanKey(key))) {
                  return String(val).trim();
                }
              }
            }
            return "";
          };

          const getLinkedInUrl = (row: Record<string, any>) => {
            const direct = getField(row, [
              "linkedin url",
              "linkedin_url",
              "linkedin",
              "person linkedin url",
              "person_linkedin_url",
              "profile url",
              "profile_url",
              "linkedin profile",
              "linkedin_profile",
              "linkedinprofileurl",
              "vmid_url",
              "vmid url",
              "sales navigator url",
              "sales navigator profile url",
              "sales_navigator_url",
              "salesnavigatorurl",
            ]);
            if (direct) return direct;

            // Fallback: check if any field contains a LinkedIn profile link
            for (const val of Object.values(row)) {
              if (typeof val === "string") {
                const trimmed = val.trim();
                if (/linkedin\.com\/(in|sales\/lead|pub|company)/i.test(trimmed)) {
                  return trimmed;
                }
              }
            }
            return "";
          };

          // Clean and format rows
          const formattedLeads = rawRows.map((r) => {
            const firstName = getField(r, ["first name", "firstname", "first"]);
            const lastName = getField(r, ["last name", "lastname", "last"]);
            let fullName = getField(r, ["full name", "fullname", "name"]);
            if (!fullName && (firstName || lastName)) {
              fullName = `${firstName} ${lastName}`.trim();
            }

            return {
              full_name: fullName,
              first_name: firstName,
              title: getField(r, ["title", "job title", "jobtitle", "headline", "position", "role"]),
              company: getField(r, ["company", "company name", "companyname", "organization", "account"]),
              industry: getField(r, ["industry", "sector", "company industry"]),
              linkedin_url: getLinkedInUrl(r) || undefined,
              email: getField(r, ["email", "email address", "work email", "corporate email", "personal email"]),
              city: getField(r, ["city", "location", "locality", "person city"]),
              location_region: getField(r, ["region", "country", "state", "location_region", "person country"]),
              email_verification_status: getField(r, ["email status", "verification status", "status"]) || "unverified",
              raw_row: r, // Keep raw row so server extractLinkedInUrl can also process it
            };
          });

          const res = await fetch("/api/leads/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode,
              leads: formattedLeads,
              queueForFollowups: mode === "mode_b" ? queueForFollowups : false,
            }),
          });

          const data = await res.json();
          if (res.ok) {
            setImportStats(data.stats);
            fetchLeads();
            setActiveTab("vault");
          } else {
            alert(`Import failed: ${data.error}`);
          }
        } catch (err: any) {
          alert(`CSV Parse error: ${err.message}`);
        } finally {
          setIsImporting(false);
        }
      },
      error: (err) => {
        setIsImporting(false);
        alert(`Failed to parse CSV file: ${err.message}`);
      },
    });
  };

  // Process Next Batch (5 Leads) Trigger
  const handleProcessNextBatch = async () => {
    setIsProcessingBatch(true);
    setProcessingStatus("Initializing AI Employee Pipeline...");

    try {
      setProcessingStatus("Loading Agent Brain, regional quotas & Jev decision engine...");
      const res = await fetch("/api/pipeline/process-leads", {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Batch processing failed");
      }

      setProcessingStatus(
        `Batch Complete: ${data.processedCount} leads processed. Outreach drafted & held at Green Light Gate.`
      );
      fetchLeads();
    } catch (err: any) {
      console.error("Batch processing error:", err);
      setProcessingStatus(`Batch Error: ${err.message}`);
    } finally {
      setTimeout(() => {
        setIsProcessingBatch(false);
        setProcessingStatus(null);
      }, 4000);
    }
  };

  // Save Voice Lead
  const handleSaveVoiceLead = async () => {
    if (!voiceLead) return;
    setSavingVoiceLead(true);

    try {
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "mode_a",
          leads: [voiceLead],
        }),
      });

      if (res.ok) {
        setVoiceLead(null);
        fetchLeads();
      } else {
        const data = await res.json();
        alert(`Failed to save lead: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Save error: ${err.message}`);
    } finally {
      setSavingVoiceLead(false);
    }
  };

  // Filtered Leads
  const filteredLeads = leads.filter((l) => {
    const matchesSearch =
      l.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.company?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.title?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStage = stageFilter === "all" || l.vault_stage === stageFilter;
    return matchesSearch && matchesStage;
  });

  return (
    <div className="space-y-6">
      {/* Top Header & Execution Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#111420] border border-[#232838] p-5 rounded-xl shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-wide font-mono flex items-center gap-2">
              MASTER LEAD VAULT & INTAKE ENGINE
              <span className="text-[10px] font-mono uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded">
                Deduplication Gate Armed
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              CSV import (zero paid APIs on upload), hands-free Groq Whisper lead capture & AI employee batch pipeline.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <VoiceRecorderButton
            mode="quick_lead"
            onTranscribed={({ leadData }) => {
              if (leadData) setVoiceLead(leadData);
            }}
          />

          <button
            onClick={handleProcessNextBatch}
            disabled={isProcessingBatch}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium shadow-md shadow-indigo-600/30 transition disabled:opacity-50"
          >
            {isProcessingBatch ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>Process Next Batch (5 Leads)</span>
          </button>
        </div>
      </div>

      {/* Batch Processing Notification Banner */}
      {processingStatus && (
        <div className="p-3.5 rounded-lg border bg-indigo-950/40 border-indigo-800/50 text-indigo-300 text-xs font-mono flex items-center space-x-2 animate-pulse">
          <RefreshCw className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
          <span>{processingStatus}</span>
        </div>
      )}

      {/* Import Stats Banner */}
      {importStats && (
        <div className="p-3.5 rounded-lg border bg-emerald-950/40 border-emerald-800/50 text-emerald-300 text-xs font-mono flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Import Complete &bull; Added: <strong>{importStats.inserted}</strong> clean leads &bull; Duplicates Skipped: <strong>{importStats.duplicatesSkipped}</strong> &bull; Locked Companies: <strong>{importStats.lockedCompanies}</strong>
            </span>
          </div>
          <button onClick={() => setImportStats(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Mode Switcher Tabs */}
      <div className="flex items-center space-x-2 border-b border-[#232838] pb-4">
        <button
          onClick={() => setActiveTab("vault")}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
            activeTab === "vault"
              ? "bg-[#1A1F2E] text-indigo-300 border border-indigo-500/30 font-semibold"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Master Vault Leads ({leads.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("mode_a")}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
            activeTab === "mode_a"
              ? "bg-[#1A1F2E] text-indigo-300 border border-indigo-500/30 font-semibold"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Mode A: New Leads CSV Uploader</span>
        </button>

        <button
          onClick={() => setActiveTab("mode_b")}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
            activeTab === "mode_b"
              ? "bg-[#1A1F2E] text-indigo-300 border border-indigo-500/30 font-semibold"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Mode B: Historical Outreach Backfill</span>
        </button>
      </div>

      {/* Mode A: Drag-and-Drop CSV Uploader */}
      {activeTab === "mode_a" && (
        <div className="bg-[#111420] border border-[#232838] rounded-xl p-8 space-y-4">
          <div className="max-w-xl mx-auto text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 mb-1">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-white">Upload New Leads to Master Vault</h3>
            <p className="text-xs text-slate-400">
              Upload raw exports from LinkedIn Sales Navigator or PhantomBuster.
              <br />
              <strong className="text-emerald-400 font-mono">Zero paid APIs run on upload.</strong> Automatic city/region normalization and deduplication against company memory.
            </p>
          </div>

          <div
            onClick={() => fileInputRefA.current?.click()}
            className="border-2 border-dashed border-[#232838] hover:border-indigo-500/50 bg-[#0E111A] rounded-xl p-8 text-center cursor-pointer transition max-w-xl mx-auto"
          >
            <input
              type="file"
              ref={fileInputRefA}
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) handleCsvUpload(e.target.files[0], "mode_a");
              }}
            />
            <Upload className="w-8 h-8 text-indigo-400 mx-auto mb-2" />
            <p className="text-xs font-medium text-slate-200">
              Click to select CSV file or drag and drop here
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Auto-maps: Full Name, Title, Company, LinkedIn URL, Email, City
            </p>
          </div>
        </div>
      )}

      {/* Mode B: Historical Outreach Backfill */}
      {activeTab === "mode_b" && (
        <div className="bg-[#111420] border border-[#232838] rounded-xl p-8 space-y-4">
          <div className="max-w-xl mx-auto text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-600/10 border border-amber-500/20 text-amber-400 mb-1">
              <History className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-white">Historical Outreach Backfill & Company Lock</h3>
            <p className="text-xs text-slate-400">
              Upload past contacted prospect sheets. Locks companies with a <strong className="text-amber-400 font-mono">90-day cooldown</strong> in the perpetual memory ledger so agents never contact the same company twice.
            </p>
          </div>

          <div className="max-w-xl mx-auto bg-[#0E111A] border border-[#232838] p-4 rounded-lg flex items-center space-x-3">
            <input
              type="checkbox"
              id="followupCheck"
              checked={queueForFollowups}
              onChange={(e) => setQueueForFollowups(e.target.checked)}
              className="w-4 h-4 rounded bg-[#080A10] border-[#232838] text-indigo-600 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="followupCheck" className="text-xs text-slate-300 cursor-pointer">
              Optionally queue unanswered leads for Day 3 / Day 7 follow-ups (<code className="text-indigo-400">queued_for_today</code>)
            </label>
          </div>

          <div
            onClick={() => fileInputRefB.current?.click()}
            className="border-2 border-dashed border-[#232838] hover:border-amber-500/50 bg-[#0E111A] rounded-xl p-8 text-center cursor-pointer transition max-w-xl mx-auto"
          >
            <input
              type="file"
              ref={fileInputRefB}
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) handleCsvUpload(e.target.files[0], "mode_b");
              }}
            />
            <Upload className="w-8 h-8 text-amber-400 mx-auto mb-2" />
            <p className="text-xs font-medium text-slate-200">
              Click to select Historical Contacted CSV
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Creates <code className="text-amber-400">historical_sent</code> outreach ledger rows & company locks
            </p>
          </div>
        </div>
      )}

      {/* Voice Lead Capture Preview Drawer / Card */}
      {voiceLead && (
        <div className="bg-[#141826] border border-indigo-500/40 rounded-xl p-5 shadow-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <h3 className="text-xs font-bold font-mono uppercase text-indigo-300">
                Voice Lead Extracted (Gemini 2.5 Flash)
              </h3>
            </div>
            <button
              onClick={() => setVoiceLead(null)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-mono text-slate-400 uppercase">Full Name</label>
              <input
                type="text"
                value={voiceLead.full_name}
                onChange={(e) => setVoiceLead({ ...voiceLead, full_name: e.target.value })}
                className="w-full bg-[#0A0D15] border border-[#232838] px-2.5 py-1.5 rounded text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-slate-400 uppercase">Company</label>
              <input
                type="text"
                value={voiceLead.company || ""}
                onChange={(e) => setVoiceLead({ ...voiceLead, company: e.target.value })}
                className="w-full bg-[#0A0D15] border border-[#232838] px-2.5 py-1.5 rounded text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-slate-400 uppercase">Title</label>
              <input
                type="text"
                value={voiceLead.title || ""}
                onChange={(e) => setVoiceLead({ ...voiceLead, title: e.target.value })}
                className="w-full bg-[#0A0D15] border border-[#232838] px-2.5 py-1.5 rounded text-xs text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-mono text-slate-400 uppercase">Email</label>
              <input
                type="email"
                value={voiceLead.email || ""}
                onChange={(e) => setVoiceLead({ ...voiceLead, email: e.target.value })}
                className="w-full bg-[#0A0D15] border border-[#232838] px-2.5 py-1.5 rounded text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-slate-400 uppercase">City & Region</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="City"
                  value={voiceLead.city || ""}
                  onChange={(e) => setVoiceLead({ ...voiceLead, city: e.target.value })}
                  className="w-2/3 bg-[#0A0D15] border border-[#232838] px-2.5 py-1.5 rounded text-xs text-white"
                />
                <select
                  value={voiceLead.location_region}
                  onChange={(e) => setVoiceLead({ ...voiceLead, location_region: e.target.value as any })}
                  className="w-1/3 bg-[#0A0D15] border border-[#232838] px-1 py-1.5 rounded text-xs text-white font-mono"
                >
                  <option value="KSA">KSA</option>
                  <option value="UAE">UAE</option>
                  <option value="UK">UK</option>
                  <option value="US">US</option>
                  <option value="OTHER">OTHER</option>
                </select>
              </div>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleSaveVoiceLead}
                disabled={savingVoiceLead}
                className="w-full py-1.5 px-3 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition flex items-center justify-center gap-1.5"
              >
                {savingVoiceLead ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                <span>Add to Master Vault</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leads Table Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#111420] border border-[#232838] p-3 rounded-xl">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search leads, company, title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#0A0D15] border border-[#232838] pl-8 pr-3 py-1.5 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="bg-[#0A0D15] border border-[#232838] px-3 py-1.5 rounded-lg text-xs text-slate-300 font-mono"
          >
            <option value="all">All Stages</option>
            <option value="vaulted">Vaulted</option>
            <option value="queued_for_today">Queued for Today</option>
            <option value="active">Active (Drafted)</option>
            <option value="archived">Archived / Rejected</option>
          </select>
          <button
            onClick={fetchLeads}
            className="p-1.5 rounded-lg border border-[#232838] bg-[#0A0D15] text-slate-400 hover:text-white"
            title="Refresh Leads"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Main Leads Table */}
      <div className="bg-[#111420] border border-[#232838] rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0C0E16] border-b border-[#232838] text-slate-400 font-mono text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Prospect</th>
                <th className="py-3 px-4">Company & Location</th>
                <th className="py-3 px-4">Jev ICP Gate</th>
                <th className="py-3 px-4">Offer & Role</th>
                <th className="py-3 px-4">Email Status</th>
                <th className="py-3 px-4">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2433]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 font-mono">
                    Loading master vault records...
                  </td>
                </tr>
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 font-mono">
                    No leads found matching current filters.
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-[#151926] transition">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white">{lead.full_name}</div>
                      <div className="text-[11px] text-slate-400 line-clamp-1">{lead.title || "No Title"}</div>
                      {lead.email && <div className="text-[10px] text-indigo-400 font-mono">{lead.email}</div>}
                    </td>

                    <td className="py-3 px-4">
                      <div className="text-slate-200 font-medium">{lead.company || "N/A"}</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                        <span>{lead.city || "Global"}</span>
                        <span className="text-[10px] text-indigo-400 uppercase font-semibold">({lead.location_region})</span>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      {lead.vault_stage === "vaulted" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-400 border border-slate-700/60 text-[10px] font-mono">
                          <Clock className="w-3 h-3 text-slate-400" />
                          Pending
                        </span>
                      ) : lead.jev_icp_qualified === true ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-mono">
                          <CheckCircle2 className="w-3 h-3" />
                          Qualified
                        </span>
                      ) : lead.jev_icp_qualified === false ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-mono">
                          <AlertCircle className="w-3 h-3" />
                          Disqualified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-400 border border-slate-700/60 text-[10px] font-mono">
                          <Clock className="w-3 h-3 text-slate-400" />
                          Pending
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-mono text-slate-300 text-[11px] flex items-center gap-1 flex-wrap">
                        <span>{lead.target_offer || "—"}</span>
                        {lead.ai_employee_role && lead.ai_employee_role !== "none" && (
                          <span className="text-purple-400 font-mono">
                            • {lead.ai_employee_role}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      {lead.email_status === "awaiting_green_light" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-mono font-bold animate-pulse">
                          <Clock className="w-3 h-3" />
                          Awaiting Green Light
                        </span>
                      ) : lead.email_status === "step1_sent" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-mono">
                          Step 1 Sent
                        </span>
                      ) : lead.email_status === "rejected" ? (
                        <span className="text-red-400 text-[10px] font-mono">Rejected</span>
                      ) : (
                        <span className="text-slate-400 text-[10px] font-mono capitalize">{lead.email_status}</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-mono text-[10px] uppercase text-slate-400 bg-[#0A0D15] border border-[#232838] px-2 py-0.5 rounded">
                        {lead.vault_stage}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
