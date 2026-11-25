"use client";

import { useState } from "react";
import {
  Sparkles,
  Image as ImageIcon,
  Linkedin,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Building2,
  User,
} from "lucide-react";

type AccountType = "personal_seshank" | "company_seshank_ai_labs";
type OfferKey = "saas_lead_gen" | "custom_ai_employee" | "founder_website";

export default function ContentStudioPage() {
  const [accountType, setAccountType] = useState<AccountType>("personal_seshank");
  const [offerKey, setOfferKey] = useState<OfferKey>("saas_lead_gen");
  const [topic, setTopic] = useState("");
  const [visualStyle, setVisualStyle] = useState("architecture_diagram");

  const [generatingPost, setGeneratingPost] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const [hookOptions, setHookOptions] = useState<string[]>([]);
  const [postBody, setPostBody] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  const handleGeneratePost = async () => {
    setGeneratingPost(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountType,
          offerKey,
          topic,
          visualStyle,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setHookOptions(data.hook_options || []);
        setPostBody(data.post_body || "");
        setImagePrompt(data.image_prompt || "");
      } else {
        setErrorMsg(data.error || "Failed to generate LinkedIn post.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Network error generating post.");
    } finally {
      setGeneratingPost(false);
    }
  };

  const getVisualPromptText = () =>
    imagePrompt.trim() ||
    `Create a high-contrast dark-mode executive LinkedIn ${visualStyle.replace(/_/g, " ")} for Seshank AI Labs (${offerKey}). Deep slate #0A0D15 background, crisp typography, indigo and emerald accents, zero clutter.`;

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast((prev) => (prev === msg ? null : prev)), 3500);
  };

  const handleCopyVisualPrompt = () => {
    const text = getVisualPromptText();
    navigator.clipboard.writeText(text);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 3000);
    showToast("Visual prompt copied to clipboard ($0 Gemini Web / Whisk ready).");
  };

  const handleCopyAndOpenGemini = () => {
    const text = getVisualPromptText();
    navigator.clipboard.writeText(text);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 3000);
    showToast("Visual prompt copied! Opening Gemini Web in a new tab.");
    window.open("https://gemini.google.com/", "_blank", "noopener,noreferrer");
  };

  const handleCopyAndOpenLinkedIn = () => {
    if (!postBody.trim()) return;
    navigator.clipboard.writeText(postBody);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
    window.open("https://www.linkedin.com/feed/", "_blank", "noopener,noreferrer");
  };

  const wordCount = postBody.split(/\s+/).filter(Boolean).length;
  const charCount = postBody.length;
  const hasEmDash = /[\u2014\u2013]|--/.test(postBody);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#111420] border border-[#232838] p-5 rounded-2xl">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Linkedin className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-wide font-mono">
              CONTENT & VISUAL STUDIO
            </h1>
            <p className="text-xs text-slate-400">
              Brand Vault-grounded LinkedIn posts (zero em dashes, peer-founder tone) + Nano Banana 2.1 dark-mode visuals.
            </p>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-950/80 border border-red-500/50 rounded-xl p-4 flex items-start justify-between gap-3 text-xs text-red-200">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 font-mono">
            Dismiss
          </button>
        </div>
      )}

      {successToast && (
        <div className="bg-emerald-950/80 border border-emerald-500/50 rounded-xl p-3.5 flex items-center justify-between gap-3 text-xs text-emerald-200">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successToast}</span>
          </div>
          <button onClick={() => setSuccessToast(null)} className="text-emerald-400 font-mono">
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Controls & Post Composer (7 cols) */}
        <div className="lg:col-span-7 bg-[#111420] border border-[#232838] rounded-2xl p-5 space-y-5">
          {/* Account Toggle */}
          <div className="space-y-2">
            <label className="text-[11px] font-mono uppercase text-slate-400">
              1. Publishing Account
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => setAccountType("personal_seshank")}
                className={`p-3 rounded-xl border text-left transition flex items-start space-x-2.5 ${
                  accountType === "personal_seshank"
                    ? "bg-blue-600/15 border-blue-500/50 text-white"
                    : "bg-[#0A0D15] border-[#232838] text-slate-400 hover:text-slate-200"
                }`}
              >
                <User className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold">Seshank Chinnapotula</div>
                  <div className="text-[10px] text-slate-400">Personal Profile &bull; Proof & Builder Stories</div>
                </div>
              </button>

              <button
                onClick={() => setAccountType("company_seshank_ai_labs")}
                className={`p-3 rounded-xl border text-left transition flex items-start space-x-2.5 ${
                  accountType === "company_seshank_ai_labs"
                    ? "bg-indigo-600/15 border-indigo-500/50 text-white"
                    : "bg-[#0A0D15] border-[#232838] text-slate-400 hover:text-slate-200"
                }`}
              >
                <Building2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold">Seshank AI Labs</div>
                  <div className="text-[10px] text-slate-400">Company Page &bull; Case Studies & Teardowns</div>
                </div>
              </button>
            </div>
          </div>

          {/* Brand Vault Offer Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase text-slate-400">
                2. Brand Vault Offer
              </label>
              <select
                value={offerKey}
                onChange={(e) => setOfferKey(e.target.value as OfferKey)}
                className="w-full px-3 py-2 rounded-lg bg-[#0A0D15] border border-[#232838] text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="saas_lead_gen">saas_lead_gen (B2B SaaS Lead Gen)</option>
                <option value="custom_ai_employee">custom_ai_employee (AI Employees)</option>
                <option value="founder_website">founder_website (Founder Authority Sites)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase text-slate-400">
                Visual Style
              </label>
              <select
                value={visualStyle}
                onChange={(e) => setVisualStyle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0A0D15] border border-[#232838] text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="architecture_diagram">Architecture Diagram</option>
                <option value="comparison_card">Comparison Card</option>
                <option value="metric_infographic">Metric Infographic</option>
                <option value="website_showcase">Website Showcase</option>
              </select>
            </div>
          </div>

          {/* Topic / Angle Input */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase text-slate-400">
              3. Topic / Builder Angle
            </label>
            <textarea
              rows={2}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., How we replaced 3 manual tools with a permission-first outbound sniper sheet for Vineet at Analytics Depot..."
              className="w-full px-3 py-2 rounded-lg bg-[#0A0D15] border border-[#232838] text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <button
            onClick={handleGeneratePost}
            disabled={generatingPost}
            className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition disabled:opacity-50"
          >
            {generatingPost ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>{generatingPost ? "Drafting Post with Gemini 2.5 Flash..." : "Generate LinkedIn Post"}</span>
          </button>

          {/* Hook Selector */}
          {hookOptions.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-[#1F2433]">
              <div className="text-[10px] font-mono uppercase text-indigo-400">
                Click a Hook to Prepend:
              </div>
              <div className="space-y-1.5">
                {hookOptions.map((h, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      const lines = postBody.split("\n");
                      lines[0] = h;
                      setPostBody(lines.join("\n"));
                    }}
                    className="w-full text-left p-2 rounded-lg bg-[#0A0D15] border border-[#232838] hover:border-indigo-500 text-xs text-slate-300 transition"
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Post Editor */}
          <div className="space-y-2 pt-2 border-t border-[#1F2433]">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-slate-400 uppercase">Post Draft</span>
              <div className="flex items-center space-x-3">
                {hasEmDash && (
                  <span className="text-red-400 font-bold">⚠ Em dash detected!</span>
                )}
                <span className="text-slate-400">
                  {wordCount} words &bull; {charCount} chars
                </span>
              </div>
            </div>

            <textarea
              rows={12}
              value={postBody}
              onChange={(e) =>
                setPostBody(
                  e.target.value.replace(/[\u2014\u2013]/g, ", ").replace(/\s*--\s*/g, ", ")
                )
              }
              placeholder="Generated LinkedIn post will appear here..."
              className="w-full px-3.5 py-3 rounded-xl bg-[#0A0D15] border border-[#232838] text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-indigo-500"
            />

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleCopyAndOpenLinkedIn}
                disabled={!postBody.trim()}
                className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition disabled:opacity-50"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copied! Opening LinkedIn..." : "Copy Post & Open LinkedIn"}</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Visual Asset Generator (5 cols) */}
        <div className="lg:col-span-5 bg-[#111420] border border-[#232838] rounded-2xl p-5 space-y-4 flex flex-col">
          <div className="flex items-center justify-between border-b border-[#1F2433] pb-3">
            <div className="flex items-center space-x-2 text-xs font-mono font-bold text-purple-400 uppercase">
              <ImageIcon className="w-4 h-4" />
              <span>Visual Prompt Studio ($0 Gemini Web)</span>
            </div>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
              $0 Workflow
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase text-slate-400">
              Visual Prompt
            </label>
            <textarea
              rows={5}
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder="Describe the dark-mode infographic, architecture diagram, or comparison card..."
              className="w-full px-3 py-2 rounded-lg bg-[#0A0D15] border border-[#232838] text-xs text-slate-200 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              onClick={handleCopyVisualPrompt}
              className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-[#1A1F2E] border border-[#2A3147] hover:border-purple-500/60 text-xs font-semibold text-slate-200 transition"
            >
              {promptCopied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-purple-400" />
              )}
              <span>{promptCopied ? "Copied!" : "Copy Visual Prompt"}</span>
            </button>

            <button
              onClick={handleCopyAndOpenGemini}
              className="flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white shadow-lg shadow-purple-600/20 transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Copy &amp; Open Gemini</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>

          <div className="flex-1 min-h-[240px] rounded-xl bg-[#0A0D15] border border-[#232838] flex items-center justify-center p-6">
            <div className="text-center space-y-2 max-w-xs">
              <ImageIcon className="w-8 h-8 text-purple-400/60 mx-auto" />
              <p className="text-xs text-slate-400 font-mono leading-relaxed">
                Copy the prompt above and paste into Gemini Web / Whisk ($0) to generate &amp; download your graphic.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
