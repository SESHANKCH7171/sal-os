"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Shield, Lock, AlertCircle, ArrowRight, Sparkles, CheckCircle2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("seshank@seshankailabs.com");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"password" | "magic_link">("password");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    const targetEmail = email.trim().toLowerCase();
    const allowedEmail = "seshank@seshankailabs.com";

    // Client-side quick check
    if (targetEmail !== allowedEmail) {
      setError(`Access Denied: This system is strictly locked to ${allowedEmail}.`);
      setLoading(false);
      return;
    }

    try {
      if (authMode === "password") {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: targetEmail,
          password: password,
        });

        if (signInError) {
          setError(signInError.message);
          setLoading(false);
          return;
        }

        if (data.user?.email?.toLowerCase().trim() !== allowedEmail) {
          await supabase.auth.signOut();
          setError(`Unauthorized identity. Terminating session.`);
          setLoading(false);
          return;
        }

        router.push("/");
        router.refresh();
      } else {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: targetEmail,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
          },
        });

        if (otpError) {
          setError(otpError.message);
          setLoading(false);
          return;
        }

        setSuccessMessage("Secure magic link dispatched to your executive inbox.");
        setLoading(false);
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected authentication error occurred.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-[#111420] border border-[#232838] p-8 rounded-2xl shadow-2xl relative overflow-hidden">
        {/* Subtle executive glow */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25 mb-4">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white font-mono">
            SESHANK AI LABS OS
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Private Executive Gateway &bull; Single-User Hardware & RLS Gate
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-950/40 border border-red-800/50 p-3.5 flex items-start space-x-3 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="font-mono">{error}</div>
          </div>
        )}

        {successMessage && (
          <div className="rounded-lg bg-emerald-950/40 border border-emerald-800/50 p-3.5 flex items-start space-x-3 text-emerald-300 text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="font-mono">{successMessage}</div>
          </div>
        )}

        <form className="mt-6 space-y-4" onSubmit={handleAuth}>
          <div>
            <label className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-1 font-mono">
              Authorized Executive Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-[#0A0D15] border border-[#232838] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
            />
          </div>

          {authMode === "password" ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-300 uppercase tracking-wider font-mono">
                  Executive Password
                </label>
                <button
                  type="button"
                  onClick={() => setAuthMode("magic_link")}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300"
                >
                  Use Magic Link
                </button>
              </div>
              <input
                type="password"
                required
                placeholder="Enter password..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg bg-[#0A0D15] border border-[#232838] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
              />
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-300 uppercase tracking-wider font-mono">
                  Authentication Mode
                </label>
                <button
                  type="button"
                  onClick={() => setAuthMode("password")}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300"
                >
                  Use Password
                </button>
              </div>
              <p className="text-xs text-slate-400 bg-[#0A0D15] p-3 rounded-lg border border-[#232838]">
                A one-click login link will be sent to <span className="text-indigo-300 font-mono">{email}</span>.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition duration-150 shadow-md shadow-indigo-600/30 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                <span>Authenticating Gate...</span>
              </span>
            ) : (
              <>
                <span>{authMode === "password" ? "Unlock Dispatch Center" : "Send Magic Link"}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="border-t border-[#1F2433] pt-4 mt-6 flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5 font-mono">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            Row Level Security (RLS) Enforced
          </span>
          <span className="font-mono">v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
