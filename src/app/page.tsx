"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Zap,
  Send,
  Mail,
  Linkedin,
  Calendar,
  RefreshCw,
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Copy,
  Activity,
  MessageSquare,
  Inbox,
} from "lucide-react";

interface DailyPlan {
  date: string;
  day_name: string;
  is_rest_day: boolean;
  active_email_regions: string[];
  paused_email_regions: Array<{ region: string; reason: string }>;
  linkedin_daily_spread: Record<string, number>;
  strategy_summary?: string;
}

interface SentEmail {
  uid: number;
  to: string;
  subject: string;
  date: string;
  snippet: string;
}

export default function CommandCenterPage() {
  const [loading, setLoading] = useState(true);
  const [statusData, setStatusData] = useState<any>(null);
  const [radarLoading, setRadarLoading] = useState(false);
  const [pauseLoading, setPauseLoading] = useState(false);
  const [regionLoading, setRegionLoading] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  const [centerTab, setCenterTab] = useState<"ledger" | "sent" | "replies">("ledger");
  const [ledgerFilter, setLedgerFilter] = useState<"all" | "email" | "linkedin">("all");
  const [sentEmails, setSentEmails] = useState<SentEmail[]>([]);
  const [sentLoading, setSentLoading] = useState(false);
  const [sentError, setSentError] = useState<string | null>(null);

  const [replyInput, setReplyInput] = useState<Record<string, string>>({});
  const [replyDraft, setReplyDraft] = useState<Record<string, { subject: string; body: string }>>({});
  const [draftLoading, setDraftLoading] = useState<Record<string, boolean>>({});
  const [sendReplyLoading, setSendReplyLoading] = useState<Record<string, boolean>>({});

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/system/status");
      const data = await res.json();
      if (res.ok) {
        setStatusData(data);
      } else {
        setBannerError(data.error || "Failed to load system status.");
      }
    } catch (err: any) {
      setBannerError(err.message || "Network error loading status.");
    } finally {
      setLoading(false);
    }
  };

  const fetchSentBox = async () => {
    setSentLoading(true);
    setSentError(null);
    try {
      const res = await fetch("/api/email/sent-history");
      const data = await res.json();
      if (res.ok) {
        setSentEmails(data.emails || []);
      } else {
        setSentError(data.error || "Failed to read Hostinger Sent mailbox.");
      }
    } catch (err: any) {
      setSentError(err.message || "IMAP connection error.");
    } finally {
      setSentLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (centerTab === "sent" && sentEmails.length === 0 && !sentLoading) {
      fetchSentBox();
    }
  }, [centerTab]);

  const handleRerunRadar = async () => {
    setRadarLoading(true);
    setBannerError(null);
    try {
      const res = await fetch("/api/cron/daily-strategy", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setBannerSuccess("Jev Morning Radar re-run complete and saved to system_flags.");
        await fetchStatus();
      } else {
        setBannerError(data.error || "Failed to re-run Morning Radar.");
      }
    } catch (err: any) {
      setBannerError(err.message);
    } finally {
      setRadarLoading(false);
    }
  };

  const handleToggleRegion = async (region: string) => {
    const plan: DailyPlan | null = statusData?.dailyPlan;
    const currentActive: string[] = plan?.active_email_regions || ["US", "UK", "UAE", "KSA"];
    const nextActive = currentActive.includes(region)
      ? currentActive.filter((r) => r !== region)
      : [...currentActive, region];

    setRegionLoading(true);
    setBannerError(null);
    try {
      const res = await fetch("/api/system/override-regions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_email_regions: nextActive }),
      });
      const data = await res.json();
      if (res.ok) {
        setBannerSuccess(`Updated active email regions: ${nextActive.join(", ") || "None"}`);
        await fetchStatus();
      } else {
        setBannerError(data.error || "Failed to update regions.");
      }
    } catch (err: any) {
      setBannerError(err.message);
    } finally {
      setRegionLoading(false);
    }
  };

  const handleTogglePause = async (shouldPause: boolean) => {
    setPauseLoading(true);
    setBannerError(null);
    try {
      const res = await fetch("/api/system/toggle-pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pause: shouldPause }),
      });
      const data = await res.json();
      if (res.ok) {
        setBannerSuccess(
          shouldPause ? "Email sending paused for 24h." : "Email sending resumed."
        );
        await fetchStatus();
      } else {
        setBannerError(data.error || "Failed to toggle pause.");
      }
    } catch (err: any) {
      setBannerError(err.message);
    } finally {
      setPauseLoading(false);
    }
  };

  const handleDraftReply = async (lead: any) => {
    const channel = lead.email_status === "replied" ? "email" : "linkedin";
    const msg = replyInput[lead.id]?.trim() || "Interested, tell me more.";
    setDraftLoading((p) => ({ ...p, [lead.id]: true }));
    try {
      const res = await fetch("/api/replies/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, channel, prospectMessage: msg }),
      });
      const data = await res.json();
      if (res.ok) {
        setReplyDraft((p) => ({
          ...p,
          [lead.id]: { subject: data.suggestedSubject, body: data.draftReply },
        }));
      } else {
        setBannerError(data.error || "Failed to draft reply.");
      }
    } catch (err: any) {
      setBannerError(err.message);
    } finally {
      setDraftLoading((p) => ({ ...p, [lead.id]: false }));
    }
  };

  const handleSendEmailReply = async (lead: any) => {
    const draft = replyDraft[lead.id];
    if (!draft?.body) return;
    setSendReplyLoading((p) => ({ ...p, [lead.id]: true }));
    try {
      const res = await fetch("/api/email/send-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          subject: draft.subject,
          body: draft.body,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setBannerSuccess(`Threaded reply dispatched to ${lead.email}.`);
        await fetchStatus();
      } else {
        setBannerError(data.error || "Failed to send email reply.");
      }
    } catch (err: any) {
      setBannerError(err.message);
    } finally {
      setSendReplyLoading((p) => ({ ...p, [lead.id]: false }));
    }
  };

  const dailyPlan: DailyPlan | null = statusData?.dailyPlan || null;
  const kpis = statusData?.kpis || {
    awaitingGreenLight: 0,
    linkedinPending: 0,
    linkedinAwaitingAcceptance: 0,
    linkedinConnected: 0,
    repliesCount: 0,
    bouncesCount: 0,
  };
  const emailPausedUntil = statusData?.emailPausedFlag?.until
    ? new Date(statusData.emailPausedFlag.until)
    : null;
  const isEmailPaused = Boolean(emailPausedUntil && emailPausedUntil > new Date());
  const dryRunEmails = statusData?.dryRunEmails ?? true;
  const dailyCap = statusData?.dailyEmailCap ?? 10;
  const sent24h = statusData?.rolling24hEmailsSent ?? 0;

  const filteredLedger = (statusData?.ledger || []).filter((item: any) => {
    if (ledgerFilter === "all") return true;
    if (ledgerFilter === "email") return item.channel === "email";
    return item.channel === "linkedin_blank_connect" || item.channel === "linkedin_dm";
  });

  return (
    <div className="space-y-6">
      {bannerError && (
        <div className="bg-red-950/80 border border-red-500/50 rounded-xl p-3.5 flex items-center justify-between text-xs text-red-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{bannerError}</span>
          </div>
          <button onClick={() => setBannerError(null)} className="text-red-400 font-mono">
            Dismiss
          </button>
        </div>
      )}

      {bannerSuccess && (
        <div className="bg-emerald-950/80 border border-emerald-500/50 rounded-xl p-3.5 flex items-center justify-between text-xs text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{bannerSuccess}</span>
          </div>
          <button onClick={() => setBannerSuccess(null)} className="text-emerald-400 font-mono">
            ✕
          </button>
        </div>
      )}

      {/* Top Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#121624] via-[#10131E] to-[#0A0D15] border border-[#232838] p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono mb-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  isEmailPaused ? "bg-red-400" : "bg-emerald-400 animate-ping"
                }`}
              ></span>
              <span className={isEmailPaused ? "text-red-400" : "text-emerald-400"}>
                {isEmailPaused ? "SYSTEM PAUSED" : "SYSTEM ACTIVE"}
              </span>
              <span className="text-slate-600">&bull;</span>
              <span
                className={`px-2 py-0.5 rounded border text-[10px] ${
                  dryRunEmails
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                }`}
              >
                DRY_RUN_EMAILS={String(dryRunEmails).toUpperCase()}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white font-mono">
              SESHANK AI LABS &bull; COMMAND CENTER
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Live daily holiday radar, follow-up priority dispatch, Hostinger inbox/sent sync, and multi-channel approval controls.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={() => handleTogglePause(!isEmailPaused)}
              disabled={pauseLoading}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-semibold border transition disabled:opacity-50 ${
                isEmailPaused
                  ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30"
                  : "bg-red-600/20 border-red-500/40 text-red-300 hover:bg-red-600/30"
              }`}
            >
              {isEmailPaused ? (
                <PlayCircle className="w-4 h-4" />
              ) : (
                <PauseCircle className="w-4 h-4" />
              )}
              <span>
                {pauseLoading
                  ? "Updating..."
                  : isEmailPaused
                  ? "Resume Email Sending"
                  : "Pause Email Sending"}
              </span>
            </button>

            <Link
              href="/queue"
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium shadow-md shadow-indigo-600/30 transition"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Review Queue ({kpis.awaitingGreenLight})</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Jev Live Daily Strategy Card */}
      <div className="bg-[#111420] border border-[#232838] rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1F2433] pb-3">
          <div className="flex items-center space-x-2.5">
            <Calendar className="w-4 h-4 text-amber-400" />
            <div>
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                Jev Live Daily Strategy{" "}
                {dailyPlan ? `(${dailyPlan.day_name} • ${dailyPlan.date})` : "(Not Generated Yet)"}
              </h2>
              <p className="text-[11px] text-slate-400">
                {dailyPlan?.strategy_summary ||
                  "Click Re-run Morning Radar to compute live holidays across US, UK, UAE & KSA."}
              </p>
            </div>
          </div>

          <button
            onClick={handleRerunRadar}
            disabled={radarLoading}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 hover:bg-amber-500/25 text-xs text-amber-300 font-mono transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${radarLoading ? "animate-spin" : ""}`} />
            <span>{radarLoading ? "Scanning..." : "Re-run Morning Radar"}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-[#0A0D15] border border-[#1F2433] rounded-xl p-3.5 space-y-2">
            <div className="text-[10px] font-mono uppercase text-slate-500">
              Active Email Regions (Click to Override)
            </div>
            <div className="flex flex-wrap gap-2">
              {["US", "UK", "UAE", "KSA"].map((reg) => {
                const isActive = dailyPlan?.active_email_regions?.includes(reg);
                return (
                  <button
                    key={reg}
                    onClick={() => handleToggleRegion(reg)}
                    disabled={regionLoading}
                    className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold border transition ${
                      isActive
                        ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                        : "bg-[#111420] border-[#232838] text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {isActive ? "✓ " : "✕ "}
                    {reg}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-[#0A0D15] border border-[#1F2433] rounded-xl p-3.5 space-y-2">
            <div className="text-[10px] font-mono uppercase text-slate-500">
              Paused Regions / Holiday Radar
            </div>
            {dailyPlan?.paused_email_regions && dailyPlan.paused_email_regions.length > 0 ? (
              <div className="space-y-1">
                {dailyPlan.paused_email_regions.map((p) => (
                  <div key={p.region} className="text-xs text-amber-300/90 font-mono">
                    <span className="font-bold text-amber-400">{p.region}:</span> {p.reason}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-emerald-400/80 font-mono">
                No active holiday pauses today.
              </div>
            )}
          </div>

          <div className="bg-[#0A0D15] border border-[#1F2433] rounded-xl p-3.5 space-y-2">
            <div className="text-[10px] font-mono uppercase text-slate-500">
              LinkedIn Daily Spread Quota
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(
                dailyPlan?.linkedin_daily_spread || { US: 0, UK: 0, UAE: 0, KSA: 0 }
              ).map(([reg, count]) => (
                <div
                  key={reg}
                  className="px-2.5 py-1 rounded bg-[#111420] border border-[#232838] text-xs font-mono text-blue-300"
                >
                  {reg}: <span className="text-white font-bold">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          href="/queue"
          className="bg-[#111420] border border-[#232838] hover:border-indigo-500/50 rounded-xl p-5 space-y-1.5 transition"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-mono uppercase text-[10px] text-amber-400">Awaiting Green Light</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">{kpis.awaitingGreenLight}</div>
          <div className="text-[11px] text-slate-400">Click to review & approve drafts &rarr;</div>
        </Link>

        <div className="bg-[#111420] border border-[#232838] rounded-xl p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-mono uppercase text-[10px] text-blue-400">LinkedIn Funnel</span>
            <Linkedin className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-lg font-bold font-mono text-white">
            {kpis.linkedinPending} <span className="text-xs text-slate-500 font-normal">Pending</span>{" "}
            &bull; {kpis.linkedinAwaitingAcceptance}{" "}
            <span className="text-xs text-slate-500 font-normal">Sent</span> &bull;{" "}
            {kpis.linkedinConnected}{" "}
            <span className="text-xs text-emerald-400 font-normal">Conn</span>
          </div>
          <div className="text-[11px] text-slate-400">Blank connects &rarr; post-connect DMs</div>
        </div>

        <div className="bg-[#111420] border border-[#232838] rounded-xl p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-mono uppercase text-[10px] text-indigo-400">Rolling 24h Emails</span>
            <Mail className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold font-mono text-white">{sent24h}</span>
            <span className="text-xs text-slate-400 font-mono">/ {dailyCap} cap</span>
          </div>
          <div className="w-full bg-[#1F2433] h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-indigo-500 h-full transition-all"
              style={{ width: `${Math.min(100, Math.round((sent24h / Math.max(1, dailyCap)) * 100))}%` }}
            ></div>
          </div>
        </div>

        <div className="bg-[#111420] border border-[#232838] rounded-xl p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-mono uppercase text-[10px] text-emerald-400">Replies & Bounces</span>
            <MessageSquare className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">
            <span className="text-emerald-400">{kpis.repliesCount}</span>{" "}
            <span className="text-xs text-slate-500 font-normal">Replies</span> /{" "}
            <span className="text-red-400">{kpis.bouncesCount}</span>{" "}
            <span className="text-xs text-slate-500 font-normal">Bounces</span>
          </div>
          <div className="text-[11px] text-slate-400">2+ bounces in 24h trips circuit breaker</div>
        </div>
      </div>

      {/* Inbox & Sent Outreach Center */}
      <div className="bg-[#111420] border border-[#232838] rounded-2xl overflow-hidden">
        <div className="bg-[#0C0E16] border-b border-[#1F2433] px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCenterTab("ledger")}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition ${
                centerTab === "ledger"
                  ? "bg-indigo-600 text-white font-semibold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Outreach Ledger Feed ({filteredLedger.length})
            </button>
            <button
              onClick={() => setCenterTab("sent")}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition ${
                centerTab === "sent"
                  ? "bg-blue-600 text-white font-semibold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Hostinger Sent Box
            </button>
            <button
              onClick={() => setCenterTab("replies")}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition ${
                centerTab === "replies"
                  ? "bg-emerald-600 text-white font-semibold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Needs Reply ({statusData?.needsReplyLeads?.length || 0})
            </button>
          </div>

          {centerTab === "ledger" && (
            <div className="flex items-center space-x-1.5">
              {(["all", "email", "linkedin"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setLedgerFilter(f)}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase ${
                    ledgerFilter === f
                      ? "bg-[#1F2433] text-white"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}

          {centerTab === "sent" && (
            <button
              onClick={fetchSentBox}
              disabled={sentLoading}
              className="flex items-center space-x-1 text-xs font-mono text-blue-400 hover:text-blue-300"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${sentLoading ? "animate-spin" : ""}`} />
              <span>Refresh IMAP Sent</span>
            </button>
          )}
        </div>

        <div className="p-5">
          {centerTab === "ledger" && (
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {loading ? (
                <div className="text-xs text-slate-500 font-mono">Loading ledger...</div>
              ) : filteredLedger.length === 0 ? (
                <div className="text-xs text-slate-500 font-mono">No outreach ledger events recorded yet.</div>
              ) : (
                filteredLedger.map((ev: any) => (
                  <div
                    key={ev.id}
                    className="p-3 rounded-xl bg-[#0A0D15] border border-[#1F2433] flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.5 rounded bg-[#151A28] text-[10px] font-mono text-indigo-300 uppercase">
                          {ev.channel}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#151A28] text-[10px] font-mono text-emerald-300 uppercase">
                          {ev.event_type}
                        </span>
                        {ev.region && (
                          <span className="text-[10px] font-mono text-slate-500">{ev.region}</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-200">{ev.summary}</p>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">
                      {new Date(ev.created_at).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {centerTab === "sent" && (
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {sentLoading ? (
                <div className="text-xs text-slate-400 font-mono">Reading Hostinger IMAP Sent mailbox...</div>
              ) : sentError ? (
                <div className="text-xs text-red-400 font-mono">{sentError}</div>
              ) : sentEmails.length === 0 ? (
                <div className="text-xs text-slate-500 font-mono">No sent emails found in Hostinger Sent folder.</div>
              ) : (
                sentEmails.map((em) => (
                  <div
                    key={em.uid}
                    className="p-3 rounded-xl bg-[#0A0D15] border border-[#1F2433] space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white">{em.subject}</span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {new Date(em.date).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-blue-300">To: {em.to}</div>
                    {em.snippet && <p className="text-xs text-slate-400 line-clamp-2">{em.snippet}</p>}
                  </div>
                ))
              )}
            </div>
          )}

          {centerTab === "replies" && (
            <div className="space-y-4">
              {!statusData?.needsReplyLeads || statusData.needsReplyLeads.length === 0 ? (
                <div className="text-xs text-slate-500 font-mono flex items-center gap-2">
                  <Inbox className="w-4 h-4" />
                  <span>No prospect replies awaiting response right now.</span>
                </div>
              ) : (
                statusData.needsReplyLeads.map((lead: any) => (
                  <div
                    key={lead.id}
                    className="p-4 rounded-xl bg-[#0A0D15] border border-emerald-500/30 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-white">
                          {lead.full_name} &bull; <span className="text-indigo-400">{lead.company}</span>
                        </div>
                        <div className="text-[11px] font-mono text-emerald-300">
                          {lead.email_status === "replied" ? `Email Reply (${lead.email})` : "LinkedIn Reply"}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDraftReply(lead)}
                        disabled={draftLoading[lead.id]}
                        className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{draftLoading[lead.id] ? "Drafting..." : "1-Click AI Reply Drafter"}</span>
                      </button>
                    </div>

                    <input
                      type="text"
                      value={replyInput[lead.id] || ""}
                      onChange={(e) => setReplyInput((p) => ({ ...p, [lead.id]: e.target.value }))}
                      placeholder="Optional: paste prospect's latest message snippet for tailored AI reply..."
                      className="w-full px-3 py-1.5 rounded-lg bg-[#111420] border border-[#232838] text-xs text-slate-200"
                    />

                    {replyDraft[lead.id] && (
                      <div className="p-3 rounded-lg bg-[#111420] border border-indigo-500/30 space-y-2">
                        <textarea
                          rows={4}
                          value={replyDraft[lead.id].body}
                          onChange={(e) =>
                            setReplyDraft((p) => ({
                              ...p,
                              [lead.id]: { ...p[lead.id], body: e.target.value },
                            }))
                          }
                          className="w-full bg-transparent text-xs text-slate-200 focus:outline-none"
                        />
                        <div className="flex items-center gap-2">
                          {lead.email_status === "replied" && lead.email && (
                            <button
                              onClick={() => handleSendEmailReply(lead)}
                              disabled={sendReplyLoading[lead.id]}
                              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>
                                {sendReplyLoading[lead.id] ? "Sending..." : "Send Threaded Email Reply"}
                              </span>
                            </button>
                          )}
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(replyDraft[lead.id].body);
                              setBannerSuccess("Reply copied to clipboard.");
                            }}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#1A1F2E] text-xs text-blue-300"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* API Quota & Circuit Breaker Strip */}
      <div className="bg-[#111420] border border-[#232838] rounded-xl p-4">
        <div className="flex items-center space-x-2 text-xs font-mono font-bold text-slate-300 uppercase mb-3">
          <Activity className="w-4 h-4 text-indigo-400" />
          <span>Today&apos;s API Usage & Circuit Breakers</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(statusData?.usageLogs || []).length === 0 ? (
            <span className="text-xs font-mono text-slate-500">No external API calls logged yet today.</span>
          ) : (
            (statusData?.usageLogs || []).map((log: any) => (
              <div
                key={log.provider}
                className="px-3 py-1.5 rounded-lg bg-[#0A0D15] border border-[#1F2433] text-xs font-mono flex items-center space-x-2"
              >
                <span className="text-slate-400">{log.provider}:</span>
                <span className="text-white font-bold">{log.requests_count}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
