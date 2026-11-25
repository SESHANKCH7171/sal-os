"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import BrandVaultEditor from "@/components/BrandVaultEditor";
import SourceBadges from "@/components/SourceBadges";
import {
  Linkedin,
  Mail,
  Database,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Sparkles,
  ExternalLink,
  Copy,
  Check,
  Send,
  AlertCircle,
  RotateCcw,
  Ban,
  UserCheck,
  RefreshCw,
  FileText,
  Tag,
  Briefcase,
  AlertTriangle,
} from "lucide-react";

export interface QueueLead {
  id: string;
  company_id: string | null;
  full_name: string;
  first_name: string;
  title: string | null;
  company: string | null;
  industry: string | null;
  linkedin_url: string | null;
  normalized_linkedin_url: string | null;
  email: string | null;
  city: string | null;
  location_region: string;
  target_offer: string | null;
  ai_employee_role: string | null;
  jev_icp_qualified?: boolean | null;
  email_status: string;
  linkedin_status: string;
  email_verification_status: string | null;
  evidence_sources: any[];
  agent_reasoning: any;
  email_subject: string | null;
  email_step1: string | null;
  email_step2_followup: string | null;
  email_step3_followup: string | null;
  linkedin_dm_delivery: string | null;
  needs_human_review: boolean;
  next_email_at: string | null;
  last_contacted_at?: string | null;
  created_at: string;
}

interface DailyPlan {
  date: string;
  day_name: string;
  is_rest_day: boolean;
  active_email_regions: string[];
  paused_email_regions: Array<{ region: string; reason: string }>;
  linkedin_daily_spread: Record<string, number>;
  strategy_summary?: string;
}

export default function QueuePage() {
  const [activeSubTab, setActiveSubTab] = useState<"linkedin" | "email" | "vault">("email");
  const [leads, setLeads] = useState<QueueLead[]>([]);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // LinkedIn Reply Drafter Drawer State
  const [replyDrawerLeadId, setReplyDrawerLeadId] = useState<string | null>(null);
  const [prospectReplyInput, setProspectReplyInput] = useState<Record<string, string>>({});
  const [draftedReplyOutput, setDraftedReplyOutput] = useState<Record<string, string>>({});
  const [replyDraftLoading, setReplyDraftLoading] = useState<Record<string, boolean>>({});

  // Editable draft states per lead
  const [draftEdits, setDraftEdits] = useState<
    Record<
      string,
      {
        subject: string;
        step1: string;
        step2: string;
        step3: string;
        isEdited: boolean;
      }
    >
  >({});

  // Regenerate Offer Modal
  const [regeneratingLeadId, setRegeneratingLeadId] = useState<string | null>(null);
  const [linkedinDmSentLeadIds, setLinkedinDmSentLeadIds] = useState<string[]>([]);

  // Global Error & Success Alerts
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const supabase = createClient();

  const showNotification = (type: "error" | "success", msg: string) => {
    if (type === "error") {
      setErrorMessage(msg);
      console.warn(`[Queue Notice]: ${msg}`);
      // auto-clear after 8 seconds
      setTimeout(() => setErrorMessage((prev) => (prev === msg ? null : prev)), 8000);
    } else {
      setSuccessToast(msg);
      setTimeout(() => setSuccessToast((prev) => (prev === msg ? null : prev)), 4000);
    }
  };

  const fetchQueueData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to fetch queue leads:", error);
        showNotification("error", `Failed to load leads from Supabase: ${error.message}`);
      } else if (data) {
        setLeads(data);

        // Initialize draft edit buffers for email queue
        const editsMap: typeof draftEdits = {};
        for (const l of data) {
          editsMap[l.id] = {
            subject: l.email_subject || "",
            step1: l.email_step1 || "",
            step2: l.email_step2_followup || "",
            step3: l.email_step3_followup || "",
            isEdited: false,
          };
        }
        setDraftEdits(editsMap);
      }

      // Fetch Jev Daily Outreach Plan from system_flags
      const { data: planRow } = await supabase
        .from("system_flags")
        .select("value")
        .eq("key", "daily_outreach_plan")
        .maybeSingle();

      if (planRow?.value) {
        setDailyPlan(planRow.value as DailyPlan);
      }

      // Fetch lead IDs that already received a post-connect LinkedIn DM
      const { data: dmRows } = await supabase
        .from("outreach_ledger")
        .select("lead_id")
        .eq("channel", "linkedin_dm");

      setLinkedinDmSentLeadIds(
        (dmRows || []).map((r: any) => r.lead_id).filter(Boolean)
      );
    } catch (err: any) {
      console.error("Queue fetch error:", err);
      showNotification("error", `Unexpected error loading queue: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueueData();
  }, []);

  const setBusy = (id: string, busy: boolean) => {
    setActionLoading((prev) => ({ ...prev, [id]: busy }));
  };

  // 1. Give Green Light & Queue
  const handleGiveGreenLight = async (lead: QueueLead) => {
    setBusy(lead.id, true);
    setErrorMessage(null);
    const draft = draftEdits[lead.id];

    try {
      const res = await fetch("/api/approval/green-light", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          email_subject: draft?.subject ?? lead.email_subject,
          email_step1: draft?.step1 ?? lead.email_step1,
          email_step2_followup: draft?.step2 ?? lead.email_step2_followup,
          email_step3_followup: draft?.step3 ?? lead.email_step3_followup,
          isEdited: draft?.isEdited ?? false,
          manualEditNote: draft?.isEdited ? "Executive edited draft Step 1 copy before Green Light." : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showNotification("success", `Green light given to ${lead.full_name}! Queued for scheduled delivery.`);
        await fetchQueueData();
      } else {
        const errorMsg = data.error || `HTTP ${res.status}: Failed to give green light`;
        console.error("Green Light error:", errorMsg, data);
        showNotification("error", `Green Light Failed: ${errorMsg}`);
      }
    } catch (err: any) {
      console.error("Approval error:", err);
      showNotification("error", `Approval network error: ${err.message || String(err)}`);
    } finally {
      setBusy(lead.id, false);
    }
  };

  // 2. Regenerate with Different Offer
  const handleRegenerateOffer = async (leadId: string, offerKey: string) => {
    setBusy(leadId, true);
    setErrorMessage(null);
    setRegeneratingLeadId(null);

    try {
      const res = await fetch("/api/pipeline/regenerate-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          newOfferKey: offerKey,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showNotification("success", `Draft regenerated for offer: ${offerKey}`);
        await fetchQueueData();
      } else {
        const errorMsg = data.error || `HTTP ${res.status}: Failed to regenerate draft`;
        console.error("Regeneration error:", errorMsg, data);
        showNotification("error", `Regeneration Failed: ${errorMsg}`);
      }
    } catch (err: any) {
      console.error("Regeneration error:", err);
      showNotification("error", `Regeneration network error: ${err.message || String(err)}`);
    } finally {
      setBusy(leadId, false);
    }
  };

  // 3. Reject / Skip Lead
  const handleReject = async (lead: QueueLead) => {
    const reason = prompt("Enter concise rejection reason (will be remembered by agent brain):", "Not a fit at this stage.");
    if (!reason) return;

    setBusy(lead.id, true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/approval/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, reason }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showNotification("success", `Lead ${lead.full_name} rejected and archived.`);
        await fetchQueueData();
      } else {
        const errorMsg = data.error || `HTTP ${res.status}: Failed to reject lead`;
        console.error("Reject error:", errorMsg, data);
        showNotification("error", `Reject Failed: ${errorMsg}`);
      }
    } catch (err: any) {
      console.error("Reject error:", err);
      showNotification("error", `Reject network error: ${err.message || String(err)}`);
    } finally {
      setBusy(lead.id, false);
    }
  };

  // 4. Mark Opt-Out / DNC
  const handleDnc = async (lead: QueueLead) => {
    if (!confirm(`Permanently lock company ${lead.company} to Do-Not-Contact and cancel all outreach?`)) return;

    setBusy(lead.id, true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/approval/dnc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, companyId: lead.company_id, reason: "Executive marked DNC" }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showNotification("success", `Company ${lead.company} locked to Do-Not-Contact.`);
        await fetchQueueData();
      } else {
        const errorMsg = data.error || `HTTP ${res.status}: Failed to mark DNC`;
        console.error("DNC error:", errorMsg, data);
        showNotification("error", `DNC Failed: ${errorMsg}`);
      }
    } catch (err: any) {
      console.error("DNC error:", err);
      showNotification("error", `DNC network error: ${err.message || String(err)}`);
    } finally {
      setBusy(lead.id, false);
    }
  };

  // LinkedIn Actions via dedicated secure API endpoint (/api/pipeline/linkedin-action)
  const handleMarkBlankConnectSent = async (lead: QueueLead) => {
    setBusy(lead.id, true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/pipeline/linkedin-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_blank_connect_sent",
          leadId: lead.id,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showNotification("success", `Blank connect request marked sent for ${lead.full_name}.`);
        await fetchQueueData();
      } else {
        const errorMsg = data.error || `HTTP ${res.status}: Failed to update LinkedIn status`;
        console.error("Mark Blank Connect Sent error:", errorMsg, data);
        showNotification("error", `Action Failed: ${errorMsg}`);
      }
    } catch (err: any) {
      console.error("Mark Blank Connect Sent network error:", err);
      showNotification("error", `Action network error: ${err.message || String(err)}`);
    } finally {
      setBusy(lead.id, false);
    }
  };

  const handleConnectedBack = async (lead: QueueLead) => {
    setBusy(lead.id, true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/pipeline/on-linkedin-connected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showNotification("success", `Connection accepted by ${lead.full_name}! Post-connect DM ready.`);
        await fetchQueueData();
      } else {
        const errorMsg = data.error || `HTTP ${res.status}: Failed to process connected event`;
        console.error("Connected trigger error:", errorMsg, data);
        showNotification("error", `Connected Action Failed: ${errorMsg}`);
      }
    } catch (err: any) {
      console.error("Connected error:", err);
      showNotification("error", `Connected network error: ${err.message || String(err)}`);
    } finally {
      setBusy(lead.id, false);
    }
  };

  const handleCopyDmAndOpenProfile = (lead: QueueLead) => {
    if (lead.linkedin_dm_delivery) {
      navigator.clipboard.writeText(lead.linkedin_dm_delivery);
      setCopiedId(lead.id);
      setTimeout(() => setCopiedId(null), 3000);
    }
    const profileUrl = lead.normalized_linkedin_url
      ? `https://${lead.normalized_linkedin_url}`
      : lead.linkedin_url;
    if (profileUrl) {
      window.open(profileUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleMarkDmSent = async (lead: QueueLead) => {
    setBusy(lead.id, true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/pipeline/linkedin-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_dm_sent",
          leadId: lead.id,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showNotification("success", `Post-connect DM marked sent for ${lead.full_name}.`);
        await fetchQueueData();
      } else {
        const errorMsg = data.error || `HTTP ${res.status}: Failed to mark DM sent`;
        console.error("Mark DM Sent error:", errorMsg, data);
        showNotification("error", `Action Failed: ${errorMsg}`);
      }
    } catch (err: any) {
      console.error("Mark DM Sent error:", err);
      showNotification("error", `Action network error: ${err.message || String(err)}`);
    } finally {
      setBusy(lead.id, false);
    }
  };

  const handleDraftLinkedInReply = async (lead: QueueLead) => {
    const msg = prospectReplyInput[lead.id]?.trim();
    if (!msg) {
      showNotification("error", "Please paste the prospect's LinkedIn message first.");
      return;
    }

    setReplyDraftLoading((prev) => ({ ...prev, [lead.id]: true }));
    setErrorMessage(null);
    try {
      const res = await fetch("/api/replies/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          channel: "linkedin",
          prospectMessage: msg,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.draftReply) {
        setDraftedReplyOutput((prev) => ({ ...prev, [lead.id]: data.draftReply }));
        showNotification("success", `Drafted peer reply for ${lead.full_name}.`);
      } else {
        showNotification("error", data.error || "Failed to draft LinkedIn reply.");
      }
    } catch (err: any) {
      showNotification("error", `Draft reply network error: ${err.message || String(err)}`);
    } finally {
      setReplyDraftLoading((prev) => ({ ...prev, [lead.id]: false }));
    }
  };

  // Filter queues
  const emailAwaitingGreenLight = leads.filter((l) => l.email_status === "awaiting_green_light");
  const activeRegions = dailyPlan?.active_email_regions || [];

  // List 1: Blank Connect Queue (linkedin_status = 'pending' or null, prioritizing active regions)
  const linkedinBlankConnectQueue = leads
    .filter(
      (l) =>
        Boolean(l.jev_icp_qualified) &&
        Boolean(l.normalized_linkedin_url || l.linkedin_url) &&
        (!l.linkedin_status || l.linkedin_status === "pending")
    )
    .sort((a, b) => {
      const aActive = activeRegions.includes((a.location_region || "").toUpperCase()) ? 1 : 0;
      const bActive = activeRegions.includes((b.location_region || "").toUpperCase()) ? 1 : 0;
      return bActive - aActive;
    });

  // List 2: Sent / Awaiting Acceptance (linkedin_status = 'sent' AND no channel='linkedin_dm' in outreach_ledger)
  const linkedinSentAwaitingQueue = leads.filter(
    (l) =>
      Boolean(l.normalized_linkedin_url || l.linkedin_url) &&
      l.linkedin_status === "sent" &&
      !linkedinDmSentLeadIds.includes(l.id)
  );

  // List 3: Connected Signals & Replies (linkedin_status IN ('connected', 'replied'))
  const linkedinConnectedAndReplies = leads.filter(
    (l) => l.linkedin_status === "connected" || l.linkedin_status === "replied"
  );

  return (
    <div className="space-y-6">
      {/* Global Error Banner */}
      {errorMessage && (
        <div className="bg-red-950/80 border border-red-500/50 rounded-xl p-4 flex items-start justify-between gap-3 text-red-200 shadow-xl animate-in fade-in duration-200">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-bold text-red-100 uppercase tracking-wider font-mono">
                Action Failed
              </div>
              <div className="text-sm font-sans mt-0.5 text-red-200 font-medium">
                {errorMessage}
              </div>
            </div>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-200 text-xs font-mono px-2 py-1 rounded bg-red-900/30 hover:bg-red-900/50 transition"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Global Success Toast */}
      {successToast && (
        <div className="bg-emerald-950/80 border border-emerald-500/50 rounded-xl p-3 flex items-center justify-between gap-3 text-emerald-200 shadow-xl animate-in fade-in duration-200">
          <div className="flex items-center space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs font-medium font-sans">{successToast}</span>
          </div>
          <button
            onClick={() => setSuccessToast(null)}
            className="text-emerald-400 hover:text-emerald-200 text-xs font-mono px-1.5 py-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {/* Subtab Navigation for Tab 4 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#232838] pb-4">
        <div className="flex items-center space-x-2 bg-[#111420] border border-[#232838] p-1 rounded-xl">
          <button
            onClick={() => setActiveSubTab("email")}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              activeSubTab === "email"
                ? "bg-indigo-600 text-white shadow-sm font-semibold"
                : "text-slate-400 hover:text-slate-200 hover:bg-[#1A1F2E]"
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>4B: Email Green Light ({emailAwaitingGreenLight.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab("linkedin")}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              activeSubTab === "linkedin"
                ? "bg-blue-600 text-white shadow-sm font-semibold"
                : "text-slate-400 hover:text-slate-200 hover:bg-[#1A1F2E]"
            }`}
          >
            <Linkedin className="w-3.5 h-3.5" />
            <span>
              4A: LinkedIn Queue (
              {linkedinBlankConnectQueue.length +
                linkedinSentAwaitingQueue.length +
                linkedinConnectedAndReplies.length}
              )
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab("vault")}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              activeSubTab === "vault"
                ? "bg-purple-600 text-white shadow-sm font-semibold"
                : "text-slate-400 hover:text-slate-200 hover:bg-[#1A1F2E]"
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>4C: Brand Vault & Roles</span>
          </button>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchQueueData}
            className="p-1.5 rounded-lg border border-[#232838] bg-[#111420] text-slate-400 hover:text-white"
            title="Refresh Queues"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>

          <div className="hidden sm:flex items-center space-x-2 text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-lg">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Green Light Gate Armed</span>
          </div>
        </div>
      </div>

      {/* ============================================================================== */}
      {/* TAB 4B: EMAIL GREEN LIGHT QUEUE (2-COLUMN VERIFY & GREEN LIGHT CARDS)          */}
      {/* ============================================================================== */}
      {activeSubTab === "email" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>
              Outreach stops strictly at <code className="text-amber-400">awaiting_green_light</code>. Review justification brief before approving.
            </span>
            <span>{emailAwaitingGreenLight.length} Sequences Awaiting Approval</span>
          </div>

          {emailAwaitingGreenLight.length === 0 ? (
            <div className="bg-[#111420] border border-[#232838] rounded-xl p-12 text-center space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-2">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-white">Queue Empty & Clean</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                No outbound emails currently awaiting green light approval. Process the next lead batch from Tab 3 to draft new personalized sequences.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {emailAwaitingGreenLight.map((lead) => {
                const draft = draftEdits[lead.id] || {
                  subject: lead.email_subject || "",
                  step1: lead.email_step1 || "",
                  step2: lead.email_step2_followup || "",
                  step3: lead.email_step3_followup || "",
                  isEdited: false,
                };

                const step1Words = draft.step1.split(/\s+/).filter(Boolean).length;
                const isOver65Words = step1Words > 65;
                const isBusy = actionLoading[lead.id];
                const reasoning = lead.agent_reasoning || {};

                return (
                  <div
                    key={lead.id}
                    className="bg-[#111420] border border-[#232838] rounded-2xl overflow-hidden shadow-2xl transition hover:border-[#2F364B]"
                  >
                    {/* Card Top Banner */}
                    <div className="bg-[#0C0E16] border-b border-[#1F2433] px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-xs">
                          {lead.first_name?.[0] || "P"}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="text-sm font-bold text-white tracking-wide">{lead.full_name}</h3>
                            <span className="text-xs text-slate-400">&bull; {lead.title || "Executive"}</span>
                            <span className="text-xs font-semibold text-indigo-300">@{lead.company}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {lead.email} &bull; {lead.city || "Global"} ({lead.location_region})
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        {lead.email_verification_status === "deliverable" ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-mono">
                            ✓ MX Deliverable
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-mono">
                            ⚠ Catch-All / Unverified
                          </span>
                        )}

                        <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono font-bold animate-pulse">
                          Awaiting Green Light
                        </span>
                      </div>
                    </div>

                    {/* 2-Column Layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#1F2433]">
                      {/* Left Column: Justification Brief & Intelligence (5 cols) */}
                      <div className="lg:col-span-5 p-6 space-y-4 bg-[#0F121C]">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400 font-bold flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5" />
                            Justification Brief
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            Confidence: {Math.round((reasoning.confidence_score || 0.9) * 100)}%
                          </span>
                        </div>

                        {/* Product Chosen */}
                        <div className="p-3 rounded-lg bg-[#0A0D15] border border-[#1F2433] space-y-1">
                          <div className="text-[10px] font-mono uppercase text-slate-500">Target Offer & Role</div>
                          <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                            <span className="text-indigo-300">{lead.target_offer || reasoning.chosen_offer || "—"}</span>
                            {lead.ai_employee_role && lead.ai_employee_role !== "none" && (
                              <span className="text-purple-400 font-mono text-[10px]">
                                • {lead.ai_employee_role}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* What They Lack */}
                        <div className="p-3 rounded-lg bg-[#0A0D15] border border-[#1F2433] space-y-1">
                          <div className="text-[10px] font-mono uppercase text-slate-500">Identified Operational Gap</div>
                          <p className="text-xs text-slate-300 leading-relaxed">
                            {reasoning.what_they_lack || "Account audited for outbound acquisition bottlenecks."}
                          </p>
                        </div>

                        {/* Why This Fits */}
                        <div className="p-3 rounded-lg bg-[#0A0D15] border border-[#1F2433] space-y-1">
                          <div className="text-[10px] font-mono uppercase text-slate-500">Why This Fits Right Now</div>
                          <p className="text-xs text-slate-300 leading-relaxed">
                            {reasoning.why_this_product || "Permission-first sniper sheet demonstrates verified value before commercial pitch."}
                          </p>
                        </div>

                        {/* How It Was Found */}
                        <div className="p-3 rounded-lg bg-[#0A0D15] border border-[#1F2433] space-y-1">
                          <div className="text-[10px] font-mono uppercase text-slate-500">Discovery Signals</div>
                          <p className="text-xs text-slate-400 leading-relaxed">
                            {reasoning.how_it_was_found || "Audited executive profile and web signals via verified research waterfall."}
                          </p>
                        </div>

                        {/* Clickable Verified Source Badges */}
                        <div>
                          <div className="text-[10px] font-mono uppercase text-slate-500 mb-1.5">
                            Verified Tier-1 Citations
                          </div>
                          <SourceBadges sources={lead.evidence_sources} />
                        </div>
                      </div>

                      {/* Right Column: Editable Draft & Actions (7 cols) */}
                      <div className="lg:col-span-7 p-6 space-y-4 flex flex-col justify-between">
                        <div className="space-y-4">
                          {/* Subject */}
                          <div>
                            <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                              Subject Line (Direct & Casual)
                            </label>
                            <input
                              type="text"
                              value={draft.subject}
                              onChange={(e) =>
                                setDraftEdits((prev) => ({
                                  ...prev,
                                  [lead.id]: { ...draft, subject: e.target.value, isEdited: true },
                                }))
                              }
                              className="w-full bg-[#0A0D15] border border-[#232838] px-3.5 py-2 rounded-lg text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                            />
                          </div>

                          {/* Step 1 Email (<65 words) */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[10px] font-mono uppercase text-slate-400">
                                Step 1: Permission-First Cold Outreach
                              </label>
                              <span
                                className={`text-[10px] font-mono ${
                                  isOver65Words ? "text-red-400 font-bold" : "text-emerald-400"
                                }`}
                              >
                                {step1Words} / 65 words {isOver65Words ? "(Limit Exceeded)" : "✓"}
                              </span>
                            </div>
                            <textarea
                              rows={4}
                              value={draft.step1}
                              onChange={(e) =>
                                setDraftEdits((prev) => ({
                                  ...prev,
                                  [lead.id]: { ...draft, step1: e.target.value, isEdited: true },
                                }))
                              }
                              className="w-full bg-[#0A0D15] border border-[#232838] px-3.5 py-2.5 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500 leading-relaxed font-sans"
                            />
                          </div>

                          {/* Step 2 & 3 Tabs / Accordion */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                                Step 2: Gentle Bump (Day 3)
                              </label>
                              <textarea
                                rows={6}
                                value={draft.step2}
                                onChange={(e) =>
                                  setDraftEdits((prev) => ({
                                    ...prev,
                                    [lead.id]: { ...draft, step2: e.target.value, isEdited: true },
                                  }))
                                }
                                className="w-full bg-[#0A0D15] border border-[#232838] px-3.5 py-2.5 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-sans leading-relaxed min-h-[150px] resize-y"
                              />
                            </div>

                            <div>
                              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                                Step 3: Breakup / Free Value (Day 7)
                              </label>
                              <textarea
                                rows={6}
                                value={draft.step3}
                                onChange={(e) =>
                                  setDraftEdits((prev) => ({
                                    ...prev,
                                    [lead.id]: { ...draft, step3: e.target.value, isEdited: true },
                                  }))
                                }
                                className="w-full bg-[#0A0D15] border border-[#232838] px-3.5 py-2.5 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-sans leading-relaxed min-h-[150px] resize-y"
                              />
                            </div>
                          </div>
                        </div>

                        {/* 4 Action Buttons */}
                        <div className="pt-4 border-t border-[#1F2433] space-y-3">
                          {draft.isEdited && (
                            <div className="text-[11px] text-amber-400 font-mono flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5" />
                              Manual edits detected &bull; Will be saved to agent memory upon Green Light.
                            </div>
                          )}

                          {regeneratingLeadId === lead.id && (
                            <div className="p-3 rounded-lg bg-[#0A0D15] border border-indigo-500/50 space-y-2">
                              <div className="text-[11px] font-mono text-indigo-300 font-semibold">
                                Select Offer for Re-Drafting:
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => handleRegenerateOffer(lead.id, "saas_lead_gen")}
                                  className="px-2.5 py-1 rounded bg-[#131722] hover:bg-indigo-600 text-xs text-white border border-[#232838]"
                                >
                                  saas_lead_gen
                                </button>
                                <button
                                  onClick={() => handleRegenerateOffer(lead.id, "custom_ai_employee")}
                                  className="px-2.5 py-1 rounded bg-[#131722] hover:bg-indigo-600 text-xs text-white border border-[#232838]"
                                >
                                  custom_ai_employee
                                </button>
                                <button
                                  onClick={() => handleRegenerateOffer(lead.id, "founder_website")}
                                  className="px-2.5 py-1 rounded bg-[#131722] hover:bg-indigo-600 text-xs text-white border border-[#232838]"
                                >
                                  founder_website
                                </button>
                                <button
                                  onClick={() => setRegeneratingLeadId(null)}
                                  className="px-2.5 py-1 rounded bg-transparent text-xs text-slate-400 hover:text-white"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => handleGiveGreenLight(lead)}
                                disabled={isBusy || isOver65Words}
                                className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-md shadow-emerald-600/20 transition disabled:opacity-50"
                              >
                                {isBusy ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                )}
                                <span>Give Green Light & Queue</span>
                              </button>

                              <button
                                onClick={() => setRegeneratingLeadId(lead.id)}
                                disabled={isBusy}
                                className="flex items-center space-x-1.5 px-3 py-2 rounded-lg border border-[#232838] bg-[#0E111A] text-xs text-slate-300 hover:text-white hover:bg-[#1A1F2E] transition disabled:opacity-50"
                              >
                                <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                                <span>Regenerate with Different Offer</span>
                              </button>
                            </div>

                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => handleReject(lead)}
                                disabled={isBusy}
                                className="flex items-center space-x-1 px-3 py-2 rounded-lg border border-red-900/40 bg-red-950/20 text-xs text-red-300 hover:bg-red-900/40 transition disabled:opacity-50"
                              >
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>Reject / Skip</span>
                              </button>

                              <button
                                onClick={() => handleDnc(lead)}
                                disabled={isBusy}
                                className="flex items-center space-x-1 px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 text-xs text-slate-400 hover:text-red-400 transition disabled:opacity-50"
                                title="Permanent Do Not Contact"
                              >
                                <Ban className="w-3.5 h-3.5" />
                                <span>Opt-Out / DNC</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================================== */}
      {/* TAB 4A: LINKEDIN QUEUE (SPLIT INTO 3 LISTS)                                    */}
      {/* ============================================================================== */}
      {activeSubTab === "linkedin" && (
        <div className="space-y-8">
          {/* Today's Daily Mission Bar */}
          {dailyPlan ? (
            dailyPlan.is_rest_day ? (
              <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-4 flex items-center justify-between gap-3">
                <div className="flex items-center space-x-3">
                  <Clock className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <div className="text-xs font-mono font-bold text-amber-300 uppercase">
                      Saturday Rest Day ({dailyPlan.date})
                    </div>
                    <p className="text-xs text-amber-200/80">
                      {dailyPlan.strategy_summary || "All automated and manual LinkedIn outreach is paused today."}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-[#0F1320] border border-[#232838] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-blue-400 font-bold">
                    Today&apos;s Daily Mission ({dailyPlan.day_name} &bull; {dailyPlan.date})
                  </div>
                  <p className="text-xs text-slate-400">
                    {dailyPlan.strategy_summary || "Prioritizing active regional targets."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {Object.entries(dailyPlan.linkedin_daily_spread || {}).map(([reg, quota]) => (
                    <span
                      key={reg}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border ${
                        quota > 0
                          ? "bg-blue-500/10 border-blue-500/30 text-blue-300"
                          : "bg-[#0A0D15] border-[#1F2433] text-slate-500"
                      }`}
                    >
                      {reg}: {quota}
                    </span>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div className="bg-[#0F1320] border border-[#232838] rounded-xl p-3 text-xs text-slate-400 font-mono">
              Daily Mission Plan not yet generated today. Run Morning Radar from Tab 1.
            </div>
          )}

          {/* List 1: Blank Connect Queue */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#232838] pb-2">
              <div className="flex items-center space-x-2 text-xs font-mono font-bold text-blue-400 uppercase">
                <Linkedin className="w-4 h-4" />
                <span>List 1: Blank Connect Queue ({linkedinBlankConnectQueue.length})</span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                Initial outreach is strictly a blank connection request (zero note).
              </span>
            </div>

            {linkedinBlankConnectQueue.length === 0 ? (
              <div className="bg-[#111420] border border-[#232838] rounded-xl p-8 text-center text-xs text-slate-500 font-mono">
                No leads pending blank connection requests.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {linkedinBlankConnectQueue.map((lead) => {
                  const profileUrl = lead.normalized_linkedin_url
                    ? `https://${lead.normalized_linkedin_url}`
                    : lead.linkedin_url;
                  const isBusy = actionLoading[lead.id];
                  const isTodayActive = activeRegions.includes(
                    (lead.location_region || "").toUpperCase()
                  );

                  return (
                    <div
                      key={lead.id}
                      className={`p-5 rounded-xl bg-[#111420] border space-y-3 flex flex-col justify-between ${
                        isTodayActive ? "border-blue-500/40" : "border-[#232838]"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center space-x-2">
                            <h4 className="text-sm font-bold text-white">{lead.full_name}</h4>
                            {isTodayActive && (
                              <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[9px] font-mono uppercase">
                                Active Today
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-slate-400 uppercase bg-[#0A0D15] px-2 py-0.5 rounded border border-[#1F2433]">
                            {lead.linkedin_status || "pending"}
                          </span>
                        </div>
                        <div className="text-xs text-slate-300 font-medium">
                          {lead.title} @ <span className="text-indigo-400">{lead.company}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {lead.city} ({lead.location_region}) &bull; Offer: {lead.target_offer || "—"}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#1F2433]">
                        {profileUrl && (
                          <a
                            href={profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#0A0D15] border border-[#232838] hover:border-blue-500 text-xs text-blue-300 transition"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Open Profile</span>
                          </a>
                        )}

                        <button
                          onClick={() => handleMarkBlankConnectSent(lead)}
                          disabled={isBusy}
                          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/30 text-xs text-blue-300 font-medium transition disabled:opacity-50"
                        >
                          {isBusy ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                          <span>{isBusy ? "Updating..." : "Mark Blank Connect Sent"}</span>
                        </button>

                        <button
                          onClick={() => handleConnectedBack(lead)}
                          disabled={isBusy}
                          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 text-xs text-emerald-300 font-semibold transition disabled:opacity-50 ml-auto"
                        >
                          {isBusy ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <UserCheck className="w-3.5 h-3.5" />
                          )}
                          <span>{isBusy ? "Processing..." : "Connected Back!"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* List 2: Sent / Awaiting Acceptance */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#232838] pb-2">
              <div className="flex items-center space-x-2 text-xs font-mono font-bold text-amber-400 uppercase">
                <Clock className="w-4 h-4" />
                <span>List 2: Sent / Awaiting Acceptance ({linkedinSentAwaitingQueue.length})</span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                Blank connect sent. Click Connected Back! once they accept (or auto-synced via IMAP).
              </span>
            </div>

            {linkedinSentAwaitingQueue.length === 0 ? (
              <div className="bg-[#111420] border border-[#232838] rounded-xl p-6 text-center text-xs text-slate-500 font-mono">
                No sent connection requests awaiting acceptance.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {linkedinSentAwaitingQueue.map((lead) => {
                  const profileUrl = lead.normalized_linkedin_url
                    ? `https://${lead.normalized_linkedin_url}`
                    : lead.linkedin_url;
                  const isBusy = actionLoading[lead.id];

                  return (
                    <div
                      key={lead.id}
                      className="p-5 rounded-xl bg-[#111420] border border-amber-500/20 space-y-3 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="text-sm font-bold text-white">{lead.full_name}</h4>
                          <span className="text-[10px] font-mono text-amber-300 uppercase bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                            Awaiting Acceptance
                          </span>
                        </div>
                        <div className="text-xs text-slate-300 font-medium">
                          {lead.title} @ <span className="text-indigo-400">{lead.company}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {lead.city} ({lead.location_region}) &bull; Offer: {lead.target_offer || "—"}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#1F2433]">
                        {profileUrl && (
                          <a
                            href={profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#0A0D15] border border-[#232838] hover:border-blue-500 text-xs text-blue-300 transition"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Open Profile</span>
                          </a>
                        )}

                        <button
                          onClick={() => handleConnectedBack(lead)}
                          disabled={isBusy}
                          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 text-xs text-emerald-300 font-semibold transition disabled:opacity-50 ml-auto"
                        >
                          {isBusy ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <UserCheck className="w-3.5 h-3.5" />
                          )}
                          <span>{isBusy ? "Processing..." : "Connected Back!"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* List 3: Connected Signals & Replies */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#232838] pb-2">
              <div className="flex items-center space-x-2 text-xs font-mono font-bold text-emerald-400 uppercase">
                <Sparkles className="w-4 h-4" />
                <span>List 3: Connected Signals & Replies ({linkedinConnectedAndReplies.length})</span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                Zero-pitch post-connect DM (&lt; 40 words) + 1-click AI Reply Drafter.
              </span>
            </div>

            {linkedinConnectedAndReplies.length === 0 ? (
              <div className="bg-[#111420] border border-[#232838] rounded-xl p-8 text-center text-xs text-slate-500 font-mono">
                No accepted connections or LinkedIn replies currently active.
              </div>
            ) : (
              <div className="space-y-4">
                {linkedinConnectedAndReplies.map((lead) => {
                  const isBusy = actionLoading[lead.id];
                  const hasCopied = copiedId === lead.id;
                  const isDrawerOpen = replyDrawerLeadId === lead.id;
                  const isDraftingReply = replyDraftLoading[lead.id];

                  return (
                    <div
                      key={lead.id}
                      className="p-5 rounded-xl bg-[#111420] border border-emerald-500/30 space-y-4 shadow-xl"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                            <h4 className="text-sm font-bold text-white">{lead.full_name}</h4>
                            <span className="text-xs text-slate-400">&bull; {lead.company}</span>
                            {lead.linkedin_status === "replied" && (
                              <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-mono uppercase">
                                Replied
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-emerald-300 font-mono mt-0.5">
                            {lead.linkedin_status === "replied"
                              ? "Prospect Replied on LinkedIn"
                              : "Connected Signal Active"}{" "}
                            &bull; Offer: {lead.target_offer}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => handleCopyDmAndOpenProfile(lead)}
                            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-md shadow-blue-600/20 transition"
                          >
                            {hasCopied ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{hasCopied ? "Copied! Opening Profile..." : "Copy DM & Open Profile"}</span>
                          </button>

                          <button
                            onClick={() => handleMarkDmSent(lead)}
                            disabled={isBusy}
                            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition disabled:opacity-50"
                          >
                            {isBusy ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            <span>{isBusy ? "Marking Sent..." : "Mark DM Sent"}</span>
                          </button>

                          <button
                            onClick={() =>
                              setReplyDrawerLeadId(isDrawerOpen ? null : lead.id)
                            }
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#0A0D15] border border-[#232838] hover:border-indigo-500 text-xs text-indigo-300 font-medium transition"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>
                              {isDrawerOpen ? "Close Reply Drafter" : "Paste Prospect Reply -> Draft Response"}
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Post-Connect Draft Box */}
                      <div className="p-3.5 rounded-lg bg-[#0A0D15] border border-[#232838] space-y-1">
                        <div className="text-[10px] font-mono uppercase text-slate-500">
                          Drafted Zero-Pitch Post-Connect DM (&lt; 40 words):
                        </div>
                        <p className="text-xs text-slate-200 font-sans leading-relaxed">
                          {lead.linkedin_dm_delivery || "Generating personalized post-connect message..."}
                        </p>
                      </div>

                      {/* Expandable Prospect Reply -> Draft Response Drawer */}
                      {isDrawerOpen && (
                        <div className="p-4 rounded-xl bg-[#0A0D15] border border-indigo-500/30 space-y-3">
                          <div className="text-[11px] font-mono uppercase text-indigo-400 font-bold">
                            LinkedIn Reply Drafter (Brand Vault + Gemini 2.5 Flash)
                          </div>
                          <textarea
                            rows={3}
                            value={prospectReplyInput[lead.id] || ""}
                            onChange={(e) =>
                              setProspectReplyInput((prev) => ({
                                ...prev,
                                [lead.id]: e.target.value,
                              }))
                            }
                            placeholder="Paste the prospect's LinkedIn reply here..."
                            className="w-full px-3 py-2 rounded-lg bg-[#111420] border border-[#232838] text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleDraftLinkedInReply(lead)}
                              disabled={isDraftingReply}
                              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-50"
                            >
                              {isDraftingReply ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="w-3.5 h-3.5" />
                              )}
                              <span>{isDraftingReply ? "Drafting..." : "Draft Peer Reply"}</span>
                            </button>
                          </div>

                          {draftedReplyOutput[lead.id] && (
                            <div className="p-3 rounded-lg bg-[#111420] border border-emerald-500/30 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono uppercase text-emerald-400">
                                  Suggested Reply (Zero Em Dashes):
                                </span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(draftedReplyOutput[lead.id]);
                                    showNotification("success", "Reply copied to clipboard!");
                                  }}
                                  className="flex items-center space-x-1 text-[11px] text-blue-400 hover:text-blue-300 font-mono"
                                >
                                  <Copy className="w-3 h-3" />
                                  <span>Copy Reply</span>
                                </button>
                              </div>
                              <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                                {draftedReplyOutput[lead.id]}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* TAB 4C: BRAND VAULT EDITOR                                                     */}
      {/* ============================================================================== */}
      {activeSubTab === "vault" && <BrandVaultEditor />}
    </div>
  );
}
